// Native HID transport for the VIA/QMK raw-HID protocol, replacing WebHID.
//
// The key win over the browser version: opening a device here doesn't need
// a per-origin user permission prompt (WebHID's `requestDevice()` requires a
// user gesture every time, by browser design) — a desktop app with normal
// OS-level HID access can just open a matching device the moment it shows
// up, so reconnecting a known keyboard can be fully automatic.
//
// Every hidapi call that touches the shared IOHIDManager (HidApi::new(),
// enumeration, open_path()) is funneled through ONE persistent background
// worker thread (`HidState::run_hid`), never run directly on whatever
// thread happens to receive the Tauri IPC call. Two failure modes led
// here, in order:
//
// 1. A shared `Mutex<HidApi>` reused across threads hung the whole app —
//    macOS's hidapi backend permanently binds its single shared
//    IOHIDManager to whichever thread calls hid_init() first (see
//    hid_init()/init_hid_manager() in hidapi's etc/hidapi/mac/hid.c), and a
//    Tauri command-handler thread pool thread has no run loop of its own to
//    service it afterwards.
// 2. Fixing that by spawning a *fresh* detached thread per call (so a hang
//    only strands one throwaway thread) traded the hang for a crash: the
//    hotplug poller's enumeration and a frontend-triggered open could then
//    run *concurrently* on different threads, and hidapi's shared manager
//    state isn't safe under genuinely concurrent, unsynchronized access —
//    that's a data race, and it segfaulted the process.
//
// The actual fix is both at once: every manager-touching call is queued to
// one single persistent worker thread (so hidapi is never touched from two
// threads at the same time, ever), while the *caller* only waits on it with
// a bounded timeout (so a job that hangs forever strands the worker, not
// the app — later calls will then also time out until restart, which is a
// far better failure mode than a freeze or a crash).
//
// Reads/writes on an *already-open* device don't have this problem — each
// opened HidDevice gets its own dedicated internal read thread with its own
// scheduled run loop (see hid_open()'s pthread_create in the same C file),
// so hid_transfer() below runs directly on whatever thread calls it.

use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// VIA's raw-HID interface: usage page 0xFF60, usage 0x61 (see quantum/via.h
/// and the official VIA app — this is a fixed, well-known convention, not
/// something we chose).
const VIA_USAGE_PAGE: u16 = 0xff60;
const VIA_USAGE: u16 = 0x61;
const REPORT_LENGTH: usize = 32;
const READ_TIMEOUT_MS: i32 = 2000;
const HID_CALL_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone, Debug)]
pub struct HidDeviceInfo {
    pub path: String,
    #[serde(rename = "vendorId")]
    pub vendor_id: u16,
    #[serde(rename = "productId")]
    pub product_id: u16,
    #[serde(rename = "productString")]
    pub product_string: Option<String>,
    #[serde(rename = "serialNumber")]
    pub serial_number: Option<String>,
}

type HidJob = Box<dyn FnOnce() + Send>;

pub struct HidState {
    /// Currently-open device handles, addressed by path over multiple calls.
    pub open: Mutex<HashMap<String, HidDevice>>,
    /// Every manager-touching hidapi call is sent here and run one at a
    /// time on a single persistent worker thread — see module doc comment.
    job_tx: mpsc::Sender<HidJob>,
}

impl HidState {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<HidJob>();
        std::thread::spawn(move || {
            for job in rx {
                job();
            }
        });
        Self {
            open: Mutex::new(HashMap::new()),
            job_tx: tx,
        }
    }

    /// Queues `f` onto the single HID worker thread and waits up to
    /// `HID_CALL_TIMEOUT` for its result. Never blocks the calling thread
    /// longer than that — if `f` hangs, this returns a timeout error and
    /// leaves the worker stuck on that job (later calls will then also
    /// time out until the app restarts), rather than freezing the caller
    /// or racing another call against the same native state.
    fn run_hid<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = mpsc::channel();
        self.job_tx
            .send(Box::new(move || {
                let _ = tx.send(f());
            }))
            .map_err(|_| "HID worker thread is gone".to_string())?;
        rx.recv_timeout(HID_CALL_TIMEOUT)
            .map_err(|_| "Timed out waiting for the HID backend".to_string())
    }
}

fn matches_via(usage_page: u16, usage: u16) -> bool {
    usage_page == VIA_USAGE_PAGE && usage == VIA_USAGE
}

fn enumerate_now() -> Result<Vec<HidDeviceInfo>, String> {
    let api = HidApi::new().map_err(|e| e.to_string())?;
    Ok(api
        .device_list()
        .filter(|d| matches_via(d.usage_page(), d.usage()))
        .map(|d| HidDeviceInfo {
            path: d.path().to_string_lossy().into_owned(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            product_string: d.product_string().map(|s| s.to_string()),
            serial_number: d.serial_number().map(|s| s.to_string()),
        })
        .collect())
}

#[tauri::command]
pub fn list_hid_devices(state: tauri::State<HidState>) -> Result<Vec<HidDeviceInfo>, String> {
    state.run_hid(enumerate_now)?
}

#[tauri::command]
pub fn open_hid_device(state: tauri::State<HidState>, path: String) -> Result<(), String> {
    if state
        .open
        .lock()
        .map_err(|e| e.to_string())?
        .contains_key(&path)
    {
        return Ok(());
    }

    let device = state.run_hid({
        let path = path.clone();
        move || -> Result<HidDevice, String> {
            let api = HidApi::new().map_err(|e| e.to_string())?;
            let c_path = std::ffi::CString::new(path).map_err(|e| e.to_string())?;
            let device = api.open_path(&c_path).map_err(|e| e.to_string())?;
            device.set_blocking_mode(true).map_err(|e| e.to_string())?;
            Ok(device)
        }
    })??;

    state
        .open
        .lock()
        .map_err(|e| e.to_string())?
        .insert(path, device);
    Ok(())
}

#[tauri::command]
pub fn close_hid_device(state: tauri::State<HidState>, path: String) -> Result<(), String> {
    let mut open = state.open.lock().map_err(|e| e.to_string())?;
    open.remove(&path);
    Ok(())
}

/// One VIA-style transaction: write a 32-byte report, then block for the
/// single 32-byte reply that always follows (the protocol is strictly
/// request/response, one-in one-out — see quantum/via.c). Holding the
/// device's map lock for the whole round trip serializes access the same
/// way the browser build's request queue does, so concurrent calls from
/// the frontend can never interleave two transactions on one device. Safe
/// to run directly (no worker-thread hop) — see module doc comment.
#[tauri::command]
pub fn hid_transfer(
    state: tauri::State<HidState>,
    path: String,
    report: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let open = state.open.lock().map_err(|e| e.to_string())?;
    let device = open
        .get(&path)
        .ok_or_else(|| "Device not open".to_string())?;

    let mut buf = [0u8; REPORT_LENGTH];
    let n = report.len().min(REPORT_LENGTH);
    buf[..n].copy_from_slice(&report[..n]);

    // hidapi's write() expects the report ID as buf[0] for devices that use
    // numbered reports; VIA's raw HID interface doesn't use report IDs, so
    // we prefix a 0x00 the same way the browser's sendReport(0, ...) does.
    let mut out = Vec::with_capacity(REPORT_LENGTH + 1);
    out.push(0x00);
    out.extend_from_slice(&buf);
    device.write(&out).map_err(|e| e.to_string())?;

    let mut resp = [0u8; REPORT_LENGTH];
    let read = device
        .read_timeout(&mut resp, READ_TIMEOUT_MS)
        .map_err(|e| e.to_string())?;
    if read == 0 {
        return Err("VIA command timed out".to_string());
    }
    Ok(resp.to_vec())
}

/// Background poll loop: diffs the enumerated VIA-capable device list every
/// tick and emits connect/disconnect events, so the frontend can auto-open
/// (or auto-close) devices without the user doing anything. hidapi has no
/// native hotplug callback that's portable across macOS/Windows/Linux, so
/// polling is the pragmatic choice here — 800ms is frequent enough to feel
/// instant when a keyboard is plugged in, without busy-looping.
pub fn spawn_hotplug_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut known: HashMap<String, HidDeviceInfo> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let current = match app.state::<HidState>().run_hid(enumerate_now) {
                Ok(Ok(list)) => list,
                _ => continue,
            };
            let current_map: HashMap<String, HidDeviceInfo> =
                current.into_iter().map(|d| (d.path.clone(), d)).collect();

            for (path, info) in current_map.iter() {
                if !known.contains_key(path) {
                    let _ = app.emit("hid-device-connected", info.clone());
                }
            }
            for path in known.keys() {
                if !current_map.contains_key(path) {
                    let _ = app.emit("hid-device-disconnected", path.clone());
                    if let Ok(mut open) = app.state::<HidState>().open.lock() {
                        open.remove(path);
                    }
                }
            }
            known = current_map;
        }
    });
}
