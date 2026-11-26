extends Node

## 《二向箔》移动端性能分档（Phase 3 真机调优）。
## 只做「平台/设备档位 → 帧率上限」这一件事，信号解耦，不碰任何场景节点。
## 桌面调试不锁帧（0=跟随显示器），移动端锁 60 省电，低端设备锁 30 保稳。
## 档位可由导出时自定义 feature "low_end" 指定，或用 apply_profile() 手动覆盖。

signal profile_applied(profile_name: String, max_fps: int)

const PROFILE_DESKTOP: String = "desktop"
const PROFILE_MOBILE: String = "mobile"
const PROFILE_LOW_END: String = "low_end"

@export var desktop_max_fps: int = 0     # 0 = 不锁帧
@export var mobile_max_fps: int = 60
@export var low_end_max_fps: int = 30

var current_profile: String = PROFILE_DESKTOP


func _ready() -> void:
	apply_auto_profile()


## 自动分档：low_end feature 优先，其次 mobile feature，否则桌面。
func apply_auto_profile() -> void:
	if OS.has_feature(PROFILE_LOW_END):
		apply_profile(PROFILE_LOW_END)
	elif OS.has_feature("mobile"):
		apply_profile(PROFILE_MOBILE)
	else:
		apply_profile(PROFILE_DESKTOP)


## 唯一写入口：设置 Engine.max_fps 并广播，测试/设置面板可手动切档。
func apply_profile(profile_name: String) -> void:
	var max_fps: int = desktop_max_fps
	match profile_name:
		PROFILE_MOBILE:
			max_fps = mobile_max_fps
		PROFILE_LOW_END:
			max_fps = low_end_max_fps
		PROFILE_DESKTOP:
			max_fps = desktop_max_fps
	if max_fps < 0:
		max_fps = 0
	Engine.max_fps = max_fps
	current_profile = profile_name
	profile_applied.emit(profile_name, max_fps)


func get_max_fps() -> int:
	return Engine.max_fps


## 供 UI 显示的档位名（中文）
func profile_label() -> String:
	match current_profile:
		PROFILE_MOBILE:
			return "移动端 60 帧（省电）"
		PROFILE_LOW_END:
			return "低配 30 帧（保稳）"
		_:
			return "桌面（跟随显示器）"
