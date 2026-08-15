//! 浏览器头像读取（Local State 中的 base64 头像 / 文件头像）

use std::fs;
use std::path::Path;


// ============ 头像读取 ============

/// 在 JSON 中递归搜索 data:image/ 开头的字符串（头像 base64 数据）
pub(crate) fn find_image_data_url(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) if s.starts_with("data:image/") && !s.is_empty() => {
            Some(s.clone())
        }
        serde_json::Value::Object(obj) => {
            for val in obj.values() {
                if let Some(found) = find_image_data_url(val) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for val in arr {
                if let Some(found) = find_image_data_url(val) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// 读取的图片数据
#[derive(Debug)]
pub struct ImageData {
    pub base64: String,
    pub is_icon: bool,
}

/// 头像缩略阈值：小于该字节数的图片直接原样 base64（避免小图重编码反而变大）
const AVATAR_THUMB_THRESHOLD: usize = 4096;

/// 将图片字节编码为 base64 data URL。
/// png/jpeg 大图（>= 4KB）压缩为 64x64 PNG，大幅减小 IPC 传输与前端列表渲染开销；
/// 缩略失败或小图时回退原样编码。
pub(crate) fn to_avatar_base64(data: &[u8], mime: &str) -> String {
    let encode_original = |bytes: &[u8]| -> String {
        format!(
            "data:{};base64,{}",
            mime,
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
        )
    };

    if data.len() >= AVATAR_THUMB_THRESHOLD && (mime == "image/png" || mime == "image/jpeg") {
        if let Ok(img) = image::load_from_memory(data) {
            let thumb = img.thumbnail(64, 64);
            let mut out = Vec::new();
            if thumb
                .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
                .is_ok()
            {
                return format!(
                    "data:image/png;base64,{}",
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &out)
                );
            }
        }
    }
    encode_original(data)
}

/// Chrome 内置预设头像资源表（index -> 文件名），来源于 Chromium
/// chrome/browser/profiles/profile_avatar_icon_util.cc 的 GetDefaultAvatarIconResourceInfo()。
/// index 26 为占位符（无图片文件，Chrome 显示默认空图标）。
/// 新版 Chrome（151+）将用户使用的预设头像图片按需下载/缓存到 {User Data}\Avatars\{文件名}。
const AVATAR_INDEX_FILES: [&str; 56] = [
    // Old avatar icons (0-25)
    "avatar_generic.png",
    "avatar_generic_aqua.png",
    "avatar_generic_blue.png",
    "avatar_generic_green.png",
    "avatar_generic_orange.png",
    "avatar_generic_purple.png",
    "avatar_generic_red.png",
    "avatar_generic_yellow.png",
    "avatar_secret_agent.png",
    "avatar_superhero.png",
    "avatar_volley_ball.png",
    "avatar_businessman.png",
    "avatar_ninja.png",
    "avatar_alien.png",
    "avatar_awesome.png",
    "avatar_flower.png",
    "avatar_pizza.png",
    "avatar_soccer.png",
    "avatar_burger.png",
    "avatar_cat.png",
    "avatar_cupcake.png",
    "avatar_dog.png",
    "avatar_horse.png",
    "avatar_margarita.png",
    "avatar_note.png",
    "avatar_sun_cloud.png",
    // Placeholder (26)
    "",
    // Modern avatar icons (27-55)
    "avatar_origami_cat.png",
    "avatar_origami_corgi.png",
    "avatar_origami_dragon.png",
    "avatar_origami_elephant.png",
    "avatar_origami_fox.png",
    "avatar_origami_monkey.png",
    "avatar_origami_panda.png",
    "avatar_origami_penguin.png",
    "avatar_origami_pinkbutterfly.png",
    "avatar_origami_rabbit.png",
    "avatar_origami_unicorn.png",
    "avatar_illustration_basketball.png",
    "avatar_illustration_bike.png",
    "avatar_illustration_bird.png",
    "avatar_illustration_cheese.png",
    "avatar_illustration_football.png",
    "avatar_illustration_ramen.png",
    "avatar_illustration_sunglasses.png",
    "avatar_illustration_sushi.png",
    "avatar_illustration_tamagotchi.png",
    "avatar_illustration_vinyl.png",
    "avatar_abstract_avocado.png",
    "avatar_abstract_cappuccino.png",
    "avatar_abstract_icecream.png",
    "avatar_abstract_icewater.png",
    "avatar_abstract_melon.png",
    "avatar_abstract_onigiri.png",
    "avatar_abstract_pizza.png",
    "avatar_abstract_sandwich.png",
];

/// 新版 Chrome/Edge（151+）预设头像：Local State 的 profile.info_cache 记录
/// avatar_icon=chrome://theme/IDR_PROFILE_AVATAR_N，头像图片按需下载/缓存到
/// {User Data}\Avatars\{文件名}。未登录但手动设置了预设头像的 profile 由此恢复。
/// 找不到（未设置头像、文件未缓存）时返回 None。
/// avatar_icon 由调用方从已解析的 Local State JSON 传入（避免每个 profile 重复读+解析大文件）。
pub(crate) fn read_avatar_file_by_index(user_data: &Path, avatar_icon: &str) -> Option<Vec<u8>> {
    let marker = "IDR_PROFILE_AVATAR_";
    let idx = avatar_icon.rfind(marker)?;
    let n: usize = avatar_icon[idx + marker.len()..].parse().ok()?;
    let fname = AVATAR_INDEX_FILES.get(n)?;
    if fname.is_empty() {
        return None;
    }
    fs::read(user_data.join("Avatars").join(fname)).ok()
}

/// 读取头像图片为 base64
pub(crate) fn read_avatar_base64(profile_path: &std::path::Path, is_edge: bool) -> ImageData {
    // 1. 尝试读取 PNG 头像（从 screenshot 目录获取）
    let screenshot_dir = profile_path.join("Screenshots");
    if screenshot_dir.exists() {
        if let Ok(entries) = fs::read_dir(&screenshot_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "png" || ext == "jpg" || ext == "jpeg" {
                        if let Ok(data) = fs::read(&path) {
                            let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
                            return ImageData {
                                base64: to_avatar_base64(&data, mime),
                                is_icon: false,
                            };
                        }
                    }
                }
            }
        }
    }

    // 2. 尝试读取 Google/Edge Profile Picture.png
    for name in &["Google Profile Picture.png", "Edge Profile Picture.png", "Profile Picture.png", "avatar.jpg", "avatar.png"] {
        let img_path = profile_path.join(name);
        if img_path.exists() {
            if let Ok(data) = fs::read(&img_path) {
                let ext = img_path.extension().and_then(|e| e.to_str()).unwrap_or("png");
                let mime = if ext == "jpg" || ext == "jpeg" { "image/jpeg" } else { "image/png" };
                return ImageData {
                    base64: to_avatar_base64(&data, mime),
                    is_icon: false,
                };
            }
        }
    }

    // 3. 尝试读取 ico 图标
    for name in &["Edge Profile.ico", "Google Profile.ico", "Profile.ico", "avatar.ico"] {
        let ico_path = profile_path.join(name);
        if ico_path.exists() {
            if let Ok(data) = fs::read(&ico_path) {
                return ImageData {
                    base64: to_avatar_base64(&data, "image/x-icon"),
                    is_icon: true,
                };
            }
        }
    }

    // 4. 尝试读取 Avatar 目录下的图片
    let avatar_dir = profile_path.join("Avatar");
    if avatar_dir.exists() {
        if let Ok(entries) = fs::read_dir(&avatar_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext == "png" || ext == "jpg" || ext == "jpeg" || ext == "webp" {
                        if let Ok(data) = fs::read(&path) {
                            let mime = match ext.to_str().unwrap_or("png") {
                                "jpg" | "jpeg" => "image/jpeg",
                                "webp" => "image/webp",
                                _ => "image/png",
                            };
                            return ImageData {
                                base64: to_avatar_base64(&data, mime),
                                is_icon: false,
                            };
                        }
                    }
                }
            }
        }
    }

    // 5. 尝试从 Preferences 递归搜索头像数据
    let prefs_path = profile_path.join("Preferences");
    if let Ok(content) = fs::read_to_string(&prefs_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            // 搜索 data:image/ 开头的值
            if let Some(pic_data) = find_image_data_url(&json) {
                return ImageData {
                    base64: pic_data,
                    is_icon: false,
                };
            }
            // 搜索 profile/gaia_info_picture_url
            if let Some(url) = json.pointer("/profile/gaia_info_picture_url")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
            {
                return ImageData {
                    base64: url.to_string(),
                    is_icon: false,
                };
            }
        }
    }

    // 6. 检查用户数据目录根层的 Avatars 目录（Edge 可能缓存主题头像）
    if is_edge {
        for av_dir_name in &["Avatars", "Profile Avatars", "GAIAPicture"] {
            let av_dir = profile_path.parent().map(|p| p.join(av_dir_name));
            if let Some(av_dir) = av_dir {
                if av_dir.exists() {
                    if let Ok(entries) = fs::read_dir(&av_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if let Some(ext) = path.extension() {
                                if ext == "png" || ext == "jpg" || ext == "webp" || ext == "ico" {
                                    if let Ok(data) = fs::read(&path) {
                                        let mime = match ext.to_str().unwrap_or("png") {
                                            "jpg" | "jpeg" => "image/jpeg",
                                            "webp" => "image/webp",
                                            "ico" => "image/x-icon",
                                            _ => "image/png",
                                        };
                                        return ImageData {
                                            base64: to_avatar_base64(&data, mime),
                                            is_icon: ext == "ico",
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 7. 新版 Chrome/Edge（151+）预设头像：由调用方用已解析的 info_cache.avatar_icon
    //    调用 read_avatar_file_by_index 处理（见 read_profiles 内），避免重复解析 Local State。

    ImageData {
        base64: String::new(),
        is_icon: false,
    }
}

