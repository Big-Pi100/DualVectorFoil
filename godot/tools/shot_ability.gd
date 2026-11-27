extends SceneTree

## Room03 的折叠纸片实拍：远看 / 走近出提示 / 拾取后。
##
## 用法（**不能加 --headless**，headless 没有 viewport）：
##   ... --script res://tools/shot_ability.gd
##
## 为什么要拍这一组：纸片是纯 Polygon2D 拼的（零新增美术），
## 断言只能证明「节点在、能按 U」，证明不了「它在米色纸场上看得见」。
## S1 的血条就吃过这个亏：逻辑全绿，实拍发现被手账按钮压住。

const ROOM_PATH := "res://world/rooms/Room03.tscn"
const OUT_DIR := "res://art/out/room"

func _initialize() -> void:
	var ps: PackedScene = load(ROOM_PATH) as PackedScene
	if ps == null:
		push_error("加载失败：%s" % ROOM_PATH)
		quit(2)
		return
	var room: Node = ps.instantiate()
	root.add_child(room)
	await process_frame

	var ws: Node = root.get_node_or_null("WorldState")
	if ws != null:
		ws.call("reset_state")
	# 敌人会走过来打人，截图不需要它们
	var box: Node = room.get_node_or_null("InvadersContainer")
	if box != null:
		for c: Node in box.get_children():
			c.queue_free()

	var player: Node2D = room.get_node_or_null("Player") as Node2D
	if player == null:
		push_error("Room03 没有 Player")
		quit(2)
		return

	await _settle(player, Vector2(250.0, 624.0), 30)
	await _shot("shot_fold_far")

	await _settle(player, Vector2(430.0, 624.0), 26)
	await _shot("shot_fold_near")

	Input.action_press("interact")
	await process_frame
	await process_frame
	Input.action_release("interact")
	for i: int in range(6):
		await process_frame
	await _shot("shot_fold_taken")

	# 第四张：折叠解锁后站上高台，看 vista 提示是否真的触发。
	# 这张是「能力 → 地图回报」闭环的**唯一**证据：
	# 断言只能证明台面高度差 240px，证明不了"站上去有东西看"。
	if ws != null:
		ws.call("unlock_ability", "fold")
	await _settle(player, Vector2(664.0, 384.0), 50)
	print("站上台后玩家 y=%.1f（384=台上，624=掉回地面）" % player.global_position.y)
	await _shot("shot_fold_onplatform")

	quit(0)

func _settle(player: Node2D, pos: Vector2, frames: int) -> void:
	player.global_position = pos
	player.set("velocity", Vector2.ZERO)
	for i: int in range(frames):
		await process_frame

func _shot(name: String) -> void:
	for i: int in range(6):
		await process_frame
	await RenderingServer.frame_post_draw
	var img: Image = root.get_texture().get_image()
	if img == null:
		push_error("viewport 取图为空（是不是加了 --headless？）")
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	var out := ProjectSettings.globalize_path("%s/%s.png" % [OUT_DIR, name])
	var err: int = img.save_png(out)
	print("SHOT %s → %s (%dx%d)" % [name, out, img.get_width(), img.get_height()])
	if err != OK:
		push_error("存图失败 %d" % err)
