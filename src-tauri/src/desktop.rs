use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

struct Desktop {
    data: PathBuf,
    endpoint: String,
    secret: String,
    child: Mutex<Child>,
    _lock: File,
}

fn app_url(url: &tauri::Url) -> bool {
    (url.scheme() == "parallax" && url.host_str() == Some("localhost") && url.port().is_none())
        || (url.scheme() == "http"
            && url.host_str() == Some("parallax.localhost")
            && url.port().is_none())
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420))
}
fn frame_url(url: &tauri::Url) -> bool {
    app_url(url)
        && url.path().ends_with(".png")
        && url.query().is_none()
        && ((url.path().starts_with("/api/coding/sessions/")
            && url.path().contains("/replay/frames/"))
            || (url.path().starts_with("/api/sessions/") && url.path().contains("/frames/")))
}

// The kernel closes this handle even after a crash. Every process launched by
// this instance belongs to its own job; no unrelated development process does.
#[cfg(windows)]
fn own_process_tree() -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{JobObjects::*, Threading::GetCurrentProcess},
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
        {
            let error = std::io::Error::last_os_error().to_string();
            CloseHandle(job);
            return Err(error);
        }
        // Keep this non-inheritable handle until the OS exits this native process.
        Ok(())
    }
}
#[cfg(not(windows))]
fn own_process_tree() -> Result<(), String> {
    Ok(())
}

fn start(app: &tauri::AppHandle) -> Result<Desktop, String> {
    let test = std::env::var("PARALLAX_DESKTOP_TEST").as_deref() == Ok("1");
    let data = if test {
        std::env::var_os("PARALLAX_DESKTOP_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or(
                app.path()
                    .app_local_data_dir()
                    .map_err(|e| e.to_string())?
                    .join("verification"),
            )
    } else {
        app.path().app_local_data_dir().map_err(|e| e.to_string())?
    };
    fs::create_dir_all(data.join("logs")).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(data.join("desktop.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock().map_err(|_| {
        "Parallax is already running for this profile. Close the existing window first.".to_owned()
    })?;
    let payload = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/desktop");
    let node = payload.join("node/node.exe");
    if !node.is_file() {
        return Err(format!(
            "Bundled Node runtime is missing. Reinstall Parallax. Expected: {}",
            node.display()
        ));
    }
    own_process_tree()?;
    let ready = data.join(format!("runner-{}.json", std::process::id()));
    let secret = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.join("logs/runner.log"))
        .map_err(|e| e.to_string())?;
    let path = std::env::join_paths(
        [payload.join("node"), payload.join("git/cmd")]
            .into_iter()
            .chain(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            )),
    )
    .map_err(|e| e.to_string())?;
    let mut command = Command::new(&node);
    command
        .arg(payload.join("runner/desktop-entry.ts"))
        .current_dir(&data)
        .env("PATH", path)
        .env_remove("npm_execpath")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env("PARALLAX_DESKTOP_DATA_DIR", &data)
        .env("PARALLAX_DESKTOP_SECRET", &secret)
        .env("PARALLAX_DESKTOP_READY", &ready)
        .env("PLAYWRIGHT_BROWSERS_PATH", payload.join("browsers"))
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not launch the bundled runner: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(40);
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(750))
        .build()
        .map_err(|e| e.to_string())?;
    while Instant::now() < deadline {
        if let Ok(contents) = fs::read(&ready) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&contents) {
                if let Some(port) = value["port"].as_u64().filter(|p| *p > 0 && *p <= 65535) {
                    let endpoint = format!("http://127.0.0.1:{port}");
                    if client
                        .get(format!("{endpoint}/api/health"))
                        .header("x-parallax-desktop", &secret)
                        .send()
                        .is_ok_and(|r| r.status().is_success())
                    {
                        let _ = fs::remove_file(&ready);
                        let _=fs::write(data.join("desktop-runtime.json"),serde_json::to_vec_pretty(&serde_json::json!({"appPid":std::process::id(),"runnerPid":child.id(),"port":port,"payload":payload,"data":data})).unwrap());
                        return Ok(Desktop {
                            data,
                            endpoint,
                            secret,
                            child: Mutex::new(child),
                            _lock: lock,
                        });
                    }
                }
            }
        }
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "The bundled runner did not become ready. Close Parallax and try again. Details: {}",
        data.join("logs/runner.log").display()
    ))
}

#[tauri::command]
async fn pick_repository(
    app: tauri::AppHandle,
    initial_path: Option<String>,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    if window.label() != "main" || !app_url(&window.url().map_err(|e| e.to_string())?) {
        return Err("The folder picker is available only in the main Parallax workspace.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("Open a local Git repository");
        if let Some(path) = initial_path.filter(|path| PathBuf::from(path).is_dir()) {
            dialog = dialog.set_directory(path);
        }
        dialog
            .blocking_pick_folder()
            .map(|file| {
                file.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_frame(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
) -> Result<(), String> {
    if window.label() != "main"
        || !app_url(&window.url().map_err(|e| e.to_string())?)
        || !path.starts_with('/')
        || path.starts_with("//")
    {
        return Err("Captured frames can be opened only from the main workspace.".into());
    }
    let url: tauri::Url = format!("parallax://localhost{path}")
        .parse()
        .map_err(|_| "Invalid recording path")?;
    if !frame_url(&url) {
        return Err("Select a captured PNG frame from this session.".into());
    }
    let frame_location = if cfg!(debug_assertions) && app.try_state::<Desktop>().is_none() {
        WebviewUrl::External(
            format!("http://127.0.0.1:1420{path}")
                .parse()
                .map_err(|_| "Invalid development recording path")?,
        )
    } else {
        WebviewUrl::CustomProtocol(url)
    };
    let mut frame = WebviewWindowBuilder::new(
        &app,
        format!("frame-{}", uuid::Uuid::new_v4()),
        frame_location,
    )
    .title("PARALLAX — Captured browser frame")
    .inner_size(1100., 800.)
    .on_navigation(frame_url)
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    if let Some(state) = app.try_state::<Desktop>() {
        frame = frame.data_directory(state.data.join("webview"));
    }
    frame.build().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pick_repository, open_frame])
        .register_asynchronous_uri_scheme_protocol("parallax", |context, request, responder| {
            let app=context.app_handle().clone();
            std::thread::spawn(move || {
                let state=app.state::<Desktop>();
                let result=(|| -> Result<tauri::http::Response<Vec<u8>>,String> {
                    // Only this instance's runner is reachable. The secret remains native.
                    let path=request.uri().path_and_query().map(|v|v.as_str()).unwrap_or("/");
                    if !path.starts_with('/') || path.starts_with("//") { return Err("Invalid application path".into()); }
                    let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(60)).build().map_err(|e|e.to_string())?;
                    let mut outgoing=client.request(request.method().clone(),format!("{}{path}",state.endpoint)).header("x-parallax-desktop",&state.secret);
                    for name in ["content-type","x-parallax-token"] {
                        if let Some(value)=request.headers().get(name) { outgoing=outgoing.header(name,value); }
                    }
                    let incoming=outgoing.body(request.body().clone()).send().map_err(|_|"The local runner stopped. Close and reopen Parallax to recover retained work.".to_owned())?;
                    let mut response=tauri::http::Response::builder().status(incoming.status());
                    for (name,value) in incoming.headers() { if name.as_str()!="transfer-encoding" && name.as_str()!="content-length" { response=response.header(name,value); } }
                    response.body(incoming.bytes().map_err(|e|e.to_string())?.to_vec()).map_err(|e|e.to_string())
                })();
                responder.respond(result.unwrap_or_else(|error|tauri::http::Response::builder().status(503).header("Content-Type","text/plain").body(error.into_bytes()).unwrap()));
            });
        })
        .setup(|app| {
            if !cfg!(debug_assertions) {
                match start(app.handle()) {
                    Ok(desktop) => { app.manage(desktop); }
                    Err(error) => {
                        let data = if std::env::var("PARALLAX_DESKTOP_TEST").as_deref() == Ok("1") {
                            std::env::var_os("PARALLAX_DESKTOP_DATA_DIR").map(PathBuf::from)
                        } else { app.path().app_local_data_dir().ok() };
                        if let Some(data) = data {
                            let _ = fs::create_dir_all(data.join("logs"));
                            let _ = fs::write(data.join("logs/startup-error.log"), &error);
                        }
                        app.dialog().message(&error).title("Parallax could not start").blocking_show();
                        return Err(error.into());
                    }
                }
            }
            let url=if cfg!(debug_assertions) { WebviewUrl::External("http://127.0.0.1:1420".parse().unwrap()) }
                else { WebviewUrl::CustomProtocol("parallax://localhost/".parse().unwrap()) };
            let mut window=WebviewWindowBuilder::new(app,"main",url).title("PARALLAX AI").inner_size(1520.,980.).min_inner_size(900.,640.)
                .center().background_color(tauri::webview::Color(36,38,41,255))
                .on_navigation(app_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
            if let Some(state)=app.try_state::<Desktop>() { window=window.data_directory(state.data.join("webview")); }
            let main = window.build()?;
            let main_app = app.handle().clone();
            main.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) { main_app.exit(0); }
            });
            Ok(())
        });
    builder
        .build(tauri::generate_context!())
        .expect("Could not initialize Parallax")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<Desktop>() {
                    let _ = reqwest::blocking::Client::builder()
                        .no_proxy()
                        .timeout(Duration::from_secs(8))
                        .build()
                        .and_then(|client| {
                            client
                                .post(format!("{}/api/desktop/shutdown", state.endpoint))
                                .header("x-parallax-desktop", &state.secret)
                                .send()
                        });
                    if let Ok(mut child) = state.child.lock() {
                        for _ in 0..40 {
                            if child.try_wait().ok().flatten().is_some() {
                                break;
                            }
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_navigation_has_an_exact_origin() {
        for value in ["http://parallax.localhost/", "parallax://localhost/pickup"] {
            assert!(app_url(&value.parse().unwrap()));
        }
        for value in [
            "https://example.com/",
            "http://parallax.localhost:4317/",
            "parallax://other/",
            "http://127.0.0.1:4317/",
        ] {
            assert!(!app_url(&value.parse().unwrap()));
        }
    }
    #[test]
    fn popups_are_only_retained_recording_images() {
        assert!(frame_url(
            &"http://parallax.localhost/api/coding/sessions/id/replay/frames/run-1.png"
                .parse()
                .unwrap()
        ));
        assert!(!frame_url(
            &"http://parallax.localhost/api/coding/config"
                .parse()
                .unwrap()
        ));
        assert!(!frame_url(
            &"https://example.com/api/sessions/id/frames/run.png"
                .parse()
                .unwrap()
        ));
    }
}
