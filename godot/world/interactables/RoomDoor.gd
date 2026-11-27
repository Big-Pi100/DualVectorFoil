class_name RoomDoor
extends Area2D

## 房间传送门：切场景前把目标出生点写入 WorldState，供 BaseRoom 定位。
## 加防抖：玩家在门内多帧停留不会重复触发切场景。

@export_file("*.tscn") var target_scene_path: String = ""
@export var target_spawn_name: String = "SpawnFromLeft"

## 门必须看得见。
##
## 2026-11-27 之前，全项目的门只有一个偏在角落的 Label（「→ 画页二」），
## 门本身是不可见的 Area2D。实拍 `shot_Room01.png` 里，玩家看到的只是
## 「房间右端多了一根灰条」—— 判断不出那是出口，只能靠猜。
##
## 这里用两个 Polygon2D 画一张纸门：外框暖纸色、内洞深褐，
## 和房间的冷灰 / 紫月拉开对比。纯几何，零新增美术。
const DOOR_W: float = 48.0
const DOOR_H: float = 96.0
## 门格在蓝图里只占 1 格（48px），但玩家身高 2 格 —— 门洞其实是 2 格高。
## 视觉往上提半格，正好覆盖「玩家站进去的整块」，否则只露半截。
const DOOR_LIFT: float = -24.0

var _is_transitioning: bool = false
var _seal_a: Polygon2D = null
var _seal_b: Polygon2D = null

## 清场前锁门。
##
## 为什么锁：清场原本只有一个 0.85s 的光波 + 紫月褪色，玩家感知不到
## 「所以我现在可以走了」。门由封到开是这间房**唯一一个功能性反馈** ——
## 它把「清场」和「离开」连成因果，而不是两句不相干的事。
##
## 锁的是「往前走的门」，不是「回安全屋的门」：死亡送回不能要玩家先清场。
var locked: bool = false

func _ready() -> void:
	monitoring = true
	body_entered.connect(_on_body_entered)
	_build_visual()
	_build_seal()

func _build_visual() -> void:
	var frame := Polygon2D.new()
	frame.name = "DoorFrame"
	frame.color = Color(0.80, 0.68, 0.50, 1.0)
	frame.polygon = _arch_points(DOOR_W, DOOR_H)
	frame.position = Vector2(0.0, DOOR_LIFT)
	frame.z_index = -3
	add_child(frame)

	var hole := Polygon2D.new()
	hole.name = "DoorHole"
	hole.color = Color(0.24, 0.21, 0.20, 1.0)
	hole.polygon = _arch_points(DOOR_W - 14.0, DOOR_H - 10.0)
	hole.position = Vector2(0.0, DOOR_LIFT + 5.0)
	hole.z_index = -2
	add_child(hole)

	var sill := Polygon2D.new()
	sill.name = "DoorSill"
	sill.color = Color(0.62, 0.50, 0.38, 1.0)
	sill.polygon = PackedVector2Array([
		Vector2(-DOOR_W * 0.5 - 4.0, DOOR_H * 0.5 - 4.0),
		Vector2(DOOR_W * 0.5 + 4.0, DOOR_H * 0.5 - 4.0),
		Vector2(DOOR_W * 0.5 + 4.0, DOOR_H * 0.5),
		Vector2(-DOOR_W * 0.5 - 4.0, DOOR_H * 0.5),
	])
	sill.position = Vector2(0.0, DOOR_LIFT)
	sill.z_index = -1
	add_child(sill)

## 拱形轮廓：两条竖边 + 顶部半圆（8 段折线近似）。
## 总高 = 直墙(高 − 半径) + 半圆(半径)，所以拱起点 y = 半径 − 高/2。
func _arch_points(w: float, h: float) -> PackedVector2Array:
	var hw: float = w * 0.5
	var y_bottom: float = h * 0.5
	var y_arch: float = hw - h * 0.5
	var pts := PackedVector2Array([
		Vector2(-hw, y_bottom),
		Vector2(-hw, y_arch),
	])
	for i: int in range(1, 8):
		var a: float = PI * (1.0 - float(i) / 8.0)
		pts.append(Vector2(cos(a) * hw, y_arch - sin(a) * hw))
	pts.append(Vector2(hw, y_bottom))
	return pts

## 纸封：两条米白斜带交叉贴在门上。不写字 ——
## 「门被封住」是通用语义，写中文反而要玩家读；而且换语言不用改。
func _build_seal() -> void:
	var w: float = DOOR_W * 0.5 + 6.0
	var h: float = DOOR_H * 0.5
	_seal_a = _make_band(-w, -h, w, h)
	_seal_b = _make_band(-w, h, w, -h)
	_seal_a.visible = false
	_seal_b.visible = false

func _make_band(x0: float, y0: float, x1: float, y1: float) -> Polygon2D:
	var band := Polygon2D.new()
	band.color = Color(0.94, 0.90, 0.80, 0.95)
	var dir: Vector2 = Vector2(x1 - x0, y1 - y0).normalized()
	var n: Vector2 = Vector2(-dir.y, dir.x) * 5.0
	band.polygon = PackedVector2Array([
		Vector2(x0, y0) + n, Vector2(x1, y1) + n,
		Vector2(x1, y1) - n, Vector2(x0, y0) - n,
	])
	band.position = Vector2(0.0, DOOR_LIFT)
	band.z_index = 1
	add_child(band)
	return band

## 锁 / 解锁。解锁时给一点闪光，让「门开了」有存在感。
func set_locked(value: bool) -> void:
	if locked == value:
		return
	locked = value
	if _seal_a != null:
		_seal_a.visible = value
	if _seal_b != null:
		_seal_b.visible = value
	if value:
		return
	var flash := Polygon2D.new()
	flash.color = Color(1.0, 0.96, 0.86, 0.85)
	flash.polygon = _arch_points(DOOR_W, DOOR_H)
	flash.position = Vector2(0.0, DOOR_LIFT)
	flash.z_index = 2
	add_child(flash)
	var tw: Tween = create_tween()
	tw.tween_property(flash, "modulate:a", 0.0, 0.45)
	tw.tween_callback(flash.queue_free)

func _on_body_entered(body: Node2D) -> void:
	if not body is Player or _is_transitioning or target_scene_path == "":
		return
	# 锁着就撞不进去。不弹提示：封条本身就是提示，玩家看得见。
	if locked:
		return
	_is_transitioning = true
	# 统一走 SceneTransition：淡入淡出 + spawn marker 写入由转场单例负责。
	# 若转场正在进行（例如刚死亡送回），本次敲门被忽略，玩家已在门内不会重复触发。
	SceneTransition.change_room(target_scene_path, target_spawn_name)
