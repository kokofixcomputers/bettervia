// A native heartbeat timer, used to pace the RGB animation player.
//
// Why this exists: WKWebView (the webview Tauri uses on macOS) throttles
// JS `setInterval`/`setTimeout` on its own, independent of anything in the
// app's code, once the window loses focus or is occluded — the same
// resource-saving behavior Safari applies to background tabs. A plain
// setInterval-based animation loop in the frontend would visibly slow down
// and eventually stall while the window isn't focused. A native OS thread
// doing a simple sleep loop isn't subject to that same webview-level
// throttling, so the frontend uses this to drive pacing instead of its own
// timer, and only does the actual frame-building/HID work in response to
// each tick.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct TickerState {
    /// Bumped every time start/stop is called; a running ticker thread
    /// checks this each tick and exits once it no longer matches the
    /// generation it was started with — this is how a new start (or an
    /// explicit stop) cancels whatever ticker thread came before it.
    generation: AtomicU64,
}

impl TickerState {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }
}

#[tauri::command]
pub fn start_ticker(app: AppHandle, interval_ms: u64) {
    let gen = {
        let state = app.state::<TickerState>();
        state.generation.fetch_add(1, Ordering::SeqCst) + 1
    };
    let interval = Duration::from_millis(interval_ms.max(10));
    std::thread::spawn(move || loop {
        std::thread::sleep(interval);
        let state = app.state::<TickerState>();
        if state.generation.load(Ordering::SeqCst) != gen {
            break;
        }
        let _ = app.emit("rgb-tick", ());
    });
}

#[tauri::command]
pub fn stop_ticker(app: AppHandle) {
    app.state::<TickerState>().generation.fetch_add(1, Ordering::SeqCst);
}
