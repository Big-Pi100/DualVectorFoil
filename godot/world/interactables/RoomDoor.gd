class_name RoomDoor
extends Area2D

## 房间传送门：切场景前把目标出生点写入 WorldState，供 BaseRoom 定位。
## 加防抖：玩家在门内多帧停留不会重复触发切场景。

@export_file("*.tscn") var target_scene_path: String = ""
@export var target_spawn_name: String = "SpawnFromLeft"

var _is_transitioning: bool = false

func _ready() -> void:
	monitoring = true
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
	if not body is Player or _is_transitioning or target_scene_path == "":
		return
	_is_transitioning = true
	# 统一走 SceneTransition：淡入淡出 + spawn marker 写入由转场单例负责。
	# 若转场正在进行（例如刚死亡送回），本次敲门被忽略，玩家已在门内不会重复触发。
	SceneTransition.change_room(target_scene_path, target_spawn_name)
