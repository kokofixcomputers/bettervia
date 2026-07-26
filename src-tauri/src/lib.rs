mod hid;
mod settings;
mod ticker;

use hid::HidState;
use ticker::TickerState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(HidState::new())
    .manage(TickerState::new())
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      hid::spawn_hotplug_watcher(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      hid::list_hid_devices,
      hid::open_hid_device,
      hid::close_hid_device,
      hid::hid_transfer,
      settings::load_settings,
      settings::save_settings,
      ticker::start_ticker,
      ticker::stop_ticker,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
