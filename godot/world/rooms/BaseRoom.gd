class_name BaseRoom
extends Node2D

## 箱庭房间基础控制器：出生点定位 → 通知步数/入侵判定 → 入侵状态与净化演出。
## 信号解耦：入侵状态变化由 WorldState 广播，本控制器只读并驱动视觉/敌人。

@export var room_id: String = "room_01"
@export var invader_count: int = 3
## 关卡脚本化的敌人编成：这间房一进门就该被占。
##
## 为什么需要它：敌人原本只由 `WorldState._try_trigger_gentle_invasion()` 生成，
## 而它的候选是「**已经种了作物**的房间」—— 种植是 P2 的东西。
## 于是全新存档进 Room01 是**空房**（2026-11-27 实测 `tools/_probe_fresh.gd`：
## `invaded_rooms = []` / 房间里敌人数量 `0` / 容器 `visible = false`）。
## 一间房最核心的「打」在真实开局里根本不存在，而测试里是手动塞了入侵状态才过的。
##
## 切片阶段一关的敌人编成是**关卡数据**，不该是种植系统的副产物。
@export var invade_on_enter: bool = false
@export var purify_tween_duration: float = 0.85
@export var purify_radius: float = 1.8
@export var is_safe_house: bool = false
## 横幅上的房间名。留空就不喊横幅 —— 不是每个房间都需要一句话。
@export var display_name: String = ""
@export var default_rest_marker: String = "SpawnFromRest"
## 房间边界 = 相机可达范围。不设 limit 的话相机居中在玩家身上，
## 走到边上会露出房间外的虚空（2026-11-27 实拍才发现的：左边半屏是空的）。
##
## ⚠️ 默认值**留空**，表示"从地形自己算"。原因是一个被测试逮到的真事故：
## 这个字段原来写死 `1280×720`（一屏时代），而 Room01 已经是 34 格 = 1632px。
## 结果 `limit_right = 1280` 让**相机中心被钳死在 640**，
## 也就是整间房里相机一动不动 —— 玩家走过 x=1280 就从屏幕右边走了出去。
## 逻辑测试全绿（能走、能开门、敌人会死），只有"人还看得见自己吗"会红。
##
## 想手动框住某间房就填一个非零 Rect2，非零即覆盖。
@export var room_bounds: Rect2 = Rect2()

const INVADER_SCENE: PackedScene = preload("res://world/enemies/Invader.tscn")

@onready var player: Player = $Player
@onready var filter_rect: ColorRect = $PostProcessLayer/DesaturateRect
# 环境光层（紫月）。测试场景没有这个节点，所以用 get_node_or_null 而不是 $。
# 它排在 DesaturateRect 之后：先变灰、再上色，紫月才照得上去。
@onready var env_rect: ColorRect = get_node_or_null("PostProcessLayer/EnvLightRect") as ColorRect
@onready var invaders_container: Node2D = $InvadersContainer

var _purify_tween: Tween = null

func _ready() -> void:
	# 1. 定位主角到对应入口 Marker2D（相对当前场景根的直接子节点）
	var spawn_name: String = str(WorldState.story_flags.get("next_spawn_marker", ""))
	if spawn_name == "" and has_node("SpawnFromLeft"):
		# 没有指定入口 = 直接从编辑器/测试里跑这张场景。这时玩家会用 tscn 里
		# 写死的位置 —— 而地形是生成器重建的，一改比例就把人塞进岩层里。
		# 2026-11-27 第五次实测：Room01 从 15 行长到 40 行之后，
		# 玩家卡在 (220, 396) 的实心里，整张图动不了，而所有单测都过
		# （它们各自 teleport）。默认落点必须跟着地形走。
		spawn_name = "SpawnFromLeft"
	if spawn_name != "" and has_node(spawn_name):
		var marker: Node = get_node(spawn_name)
		if marker is Marker2D:
			player.global_position = (marker as Marker2D).global_position
	WorldState.story_flags.erase("next_spawn_marker")

	# 2. 通知全局状态机推进探索步数与入侵判定
	#    先登记安全屋身份再 notify —— notify 里会跑入侵判定，顺序反了就拦不住
	if is_safe_house:
		WorldState.register_safe_room(room_id)
	# 必须在 notify 之前：notify 里的温和入侵可能挑别的房，先把自己这间占掉更确定
	_ensure_scripted_invasion()
	WorldState.notify_room_entered(room_id)

	# 3. 按入侵状态布置场景
	_setup_invasion_state()

	# 3.5 相机限制在房间边界内，走到边上不会露出房间外
	_apply_camera_bounds()

	# 4. 绑定玩家死亡信号 → 零惩罚送回最近休息点
	_bind_player_signals()

	# 5. 机关门接线：房间里所有拉杆 → 同一扇闸门
	#    为什么放在房间而不是让 Lever 自己去找 Gate：
	#    Lever 只需要知道"我被扳了"，它不该知道门在哪。房间才是那个知道全局的人。
	_bind_mechanisms()

	# 6. 线框稿模式：关掉全部氛围调色
	_apply_wire_mode_look()

## 房间根下有 `WireOverlay` = 这一版产物是线框设计稿（生成器写的）。
##
## 为什么要在这里关调色：紫月环境光、去饱和、纸纹是给"有贴图的成品"配的。
## 叠在深底几何图上，紫光会把冷色描边染成和背景一样、去饱和会把橙色平台
## 变成灰线 —— 三种颜色一旦分不开，线框稿就白做了。
## 它和"漏进一张贴图"是同一类错误：不影响功能，只毁掉可读性。
func _apply_wire_mode_look() -> void:
	if get_node_or_null("WireOverlay") == null:
		return
	var ppl: Node = get_node_or_null("PostProcessLayer")
	if ppl is CanvasLayer:
		(ppl as CanvasLayer).visible = false

func _bind_mechanisms() -> void:
	var mech: Node = get_node_or_null("Mechanisms")
	if mech == null:
		return
	var gate: Node = mech.get_node_or_null("Gate")
	if gate == null or not gate.has_method("open"):
		return
	for child: Node in mech.get_children():
		# 用信号名而不是 Lever 类型：房间脚本不该依赖交互物的类名，
		# 也不该因为"以后换一版拉杆"就改这里（AGENTS.md：跨模块一律 Signal）。
		if not child.has_signal("pulled"):
			continue
		var cb := Callable(gate, "open")
		if not child.is_connected("pulled", cb):
			child.connect("pulled", cb)

## 从 `Terrain/Solids` 的碰撞矩形合并出房间 AABB。
##
## 为什么用碰撞体而不是"读蓝图列数"：运行时不认识蓝图，而 Solids 就是
## 玩家真正撞得到的那一圈墙 —— 用它算出来的边界，一定和玩家能去的地方重合。
## 合并矩形是贪心出来的、可能不含最外圈（比如第 11 行两端为门留了空），
## 但天花板/地面那几行一定铺满整宽，AABB 照样到墙。
func _derive_room_bounds() -> Rect2:
	var solids: Node = get_node_or_null("Terrain/Solids")
	if solids == null:
		return Rect2(0.0, 0.0, 1280.0, 720.0)
	var box: Rect2 = Rect2()
	var found: bool = false
	for child: Node in solids.get_children():
		var cs: CollisionShape2D = child as CollisionShape2D
		if cs == null or not (cs.shape is RectangleShape2D):
			continue
		var size: Vector2 = (cs.shape as RectangleShape2D).size
		var one: Rect2 = Rect2(cs.position - size * 0.5, size)
		box = one if not found else box.merge(one)
		found = true
	return box if found else Rect2(0.0, 0.0, 1280.0, 720.0)

func _apply_camera_bounds() -> void:
	if player == null:
		return
	var cam: Camera2D = player.get_node_or_null("Camera2D") as Camera2D
	if cam == null:
		return
	var bounds: Rect2 = room_bounds if room_bounds.size.x > 0.0 else _derive_room_bounds()
	cam.limit_left = int(bounds.position.x)
	cam.limit_top = int(bounds.position.y)
	cam.limit_right = int(bounds.position.x + bounds.size.x)
	cam.limit_bottom = int(bounds.position.y + bounds.size.y)

func _bind_player_signals() -> void:
	if player == null:
		return
	# HUD 必须在这里显式绑定：Player 不会自己找 HUD，HUD 也不会自己找 Player
	# （`_input` 里 `if not player: return`）。2026-11-27 实测：正式 6 间房从来没绑过，
	# 手机上**所有触屏操作都不响应**，而键盘走 Input 单例、照样能玩 —— 所以一直没暴露。
	var hud: Node = get_node_or_null("TouchHUD")
	if hud != null and hud.has_method("bind_player"):
		hud.call("bind_player", player)
	if not player.respawn_requested.is_connected(_on_player_respawn_requested):
		player.respawn_requested.connect(_on_player_respawn_requested)

func _on_player_respawn_requested() -> void:
	if player == null:
		return
	# 安全屋内倒下：原地挪回休息点 Marker，不重新加载场景（无黑屏）。
	if is_safe_house and has_node(default_rest_marker):
		var local_marker: Node = get_node(default_rest_marker)
		if local_marker is Marker2D:
			player.global_position = (local_marker as Marker2D).global_position
		# 暗房里本不该有敌人（register_safe_room 已挡住温和入侵）。
		# 但旧存档可能在规则生效前就把 safe_house 占掉了 —— 那会变成
		# 「原地复活 → 继续挨打 → 再死」的死循环，退出条件是玩家放弃游戏。
		# 所以这里兜一次底：清场 + 标记为已净化（重生不刷、以后也不再被挑中）。
		if WorldState.invaded_rooms.has(room_id):
			_clear_invaders()
			WorldState.purify_room(room_id)
		# 血回满的责任在玩家自己：Player 死亡时故意停在 0 血，让 HUD 真的见底过
		player.revive()
		return

	var target_path: String = WorldState.last_rest_scene_path
	if target_path.is_empty():
		push_warning("BaseRoom: 最近休息点为空，无法送回玩家")
		return
	# force=true：死亡送回是必须执行的转场，即使当前正在转场也要抢占。
	# 血量不在这里补：新场景的 Player._ready 会按 @export 满血满瓶初始化。
	SceneTransition.change_room(target_path, WorldState.last_rest_spawn_marker, true)

## 把「这间房一进门就该被占」写成关卡数据，而不是等种植系统攒够步数。
## 三条跳过条件都是**状态**判断，不是时间判断 —— 所以它幂等：
## 同一间房连续进 10 次，`invaded_rooms` 里也只有一个 room_id。
func _ensure_scripted_invasion() -> void:
	if not invade_on_enter:
		return
	# 暗房不能有敌人（register_safe_room 之前就挡住，双保险）
	if is_safe_house or WorldState.safe_room_ids.has(room_id):
		return
	# 清过的房不再入侵（S1 判据：已清房不复活）
	if WorldState.purified_rooms.has(room_id):
		return
	if WorldState.invaded_rooms.has(room_id):
		return
	# 直接 append 到原数组：`WorldState.set("invaded_rooms", [...])` 对
	# `Array[String]` 是**静默失败**的，踩过两次。
	WorldState.invaded_rooms.append(room_id)

func _setup_invasion_state() -> void:
	_clear_invaders()
	var is_invaded: bool = WorldState.invaded_rooms.has(room_id)
	var mat: ShaderMaterial = filter_rect.material as ShaderMaterial

	if is_invaded:
		if mat != null:
			mat.set_shader_parameter("desaturate_amount", 1.0)
			mat.set_shader_parameter("wipe_radius", 0.0)
		invaders_container.visible = true
		for i: int in range(invader_count):
			_spawn_invader(i)
		_alert_all_invaders()
	else:
		if mat != null:
			mat.set_shader_parameter("desaturate_amount", 0.0)
			mat.set_shader_parameter("wipe_radius", 0.0)
		# 只隐藏容器，绝不 queue_free 容器本身 —— 否则二次入侵时引用已释放节点会崩
		invaders_container.visible = false

	# 环境光跟着侵占状态走：被占 = 紫月，清完 = 日光。
	# 这是「一份美术两套光照」的入口 —— 不需要给地面出 _dark / _ally 两张图。
	_set_env_night(1.0 if is_invaded else 0.0)

	# 门跟着侵占状态走：没清干净时出口是纸封的。
	# 这是这间房唯一一个**功能性**的清场反馈（光效只是气氛）。
	_set_exit_doors_locked(is_invaded)


## 清场横幅：把「光波 / 门开 / 敌人消失」收束成一句玩家能复述的话。
## 用 has_method 而不是类型断言：房间可以没有这个节点，也可以换别的实现。
func _announce_purified() -> void:
	if display_name.is_empty():
		return
	var banner: Node = get_node_or_null("StatusBanner")
	if banner != null and banner.has_method("show_text"):
		banner.call("show_text", "%s · 清空" % display_name)

## 只锁「往前走的门」。回安全屋的门永远开着 ——
## 死亡送回、主动撤退都不该要求玩家先把这间房清干净。
func _set_exit_doors_locked(value: bool) -> void:
	var doors: Node = get_node_or_null("Doors")
	if doors == null:
		return
	for child: Node in doors.get_children():
		var door := child as RoomDoor
		if door == null:
			continue
		if door.target_scene_path.ends_with("SafeHouse.tscn"):
			continue
		door.set_locked(value)

## 设置紫月强度。duration>0 时补间过去（净化用）。
func _set_env_night(target: float, duration: float = 0.0) -> void:
	if env_rect == null:
		return
	var mat: ShaderMaterial = env_rect.material as ShaderMaterial
	if mat == null:
		return
	if duration <= 0.0:
		mat.set_shader_parameter("night", target)
		return
	var from: float = float(mat.get_shader_parameter("night"))
	var tw: Tween = create_tween()
	tw.tween_method(func(v: float) -> void: mat.set_shader_parameter("night", v),
		from, target, duration).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)

## 调试：F3 手动开关紫月，在实机里直接看两套光照的差别。
## 正常玩法下 night 由侵占状态驱动，不需要按键。
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F3:
		if env_rect == null:
			return
		var mat: ShaderMaterial = env_rect.material as ShaderMaterial
		if mat == null:
			return
		var cur: float = float(mat.get_shader_parameter("night"))
		_set_env_night(0.0 if cur > 0.5 else 1.0, 0.35)
		get_viewport().set_input_as_handled()

## 入侵开始 = 一次遭遇开始。把全房敌人同时唤醒 ——
##
## 只靠 320px 察觉半径，一间 1920px 宽的房间会被切成 6 段：玩家一个个走过去打，
## 每次只面对 1 只。实测「12 秒无损清场」—— 那不是战斗，是收割。
## 唤醒之后敌人仍然走原来的 CHASE/WINDUP/ACTIVE，只是不再需要"你先走近我"。
func _alert_all_invaders() -> void:
	for child: Node in invaders_container.get_children():
		var ai: Node = child.get_node_or_null("AI")
		if ai != null and ai.has_method("alert"):
			ai.call("alert")

func _clear_invaders() -> void:
	# 同步从场景树移除，保证 get_child_count() 立即归零
	for child: Node in invaders_container.get_children():
		invaders_container.remove_child(child)
		child.queue_free()

func _spawn_invader(index: int) -> void:
	var invader: Area2D = INVADER_SCENE.instantiate() as Area2D
	invader.name = "Invader%d" % index
	invader.position = _invader_spawn_pos(index)
	invaders_container.add_child(invader)
	# 视觉变体来自蓝图的 marker meta，不按索引轮换 ——
	# `index % 3` 等于「关卡想在这里放一只蝙蝠，但放不进去」。
	# 契约不变：纯贴图/@export 差异，不影响血量与信号。
	var visual: Node = invader.get_node_or_null("Visual")
	if visual != null and visual.has_method("set_variant"):
		var marker: Node = get_node_or_null("EnemySpawn%d" % index)
		var variant: int = 0
		if marker != null and marker.has_meta("variant"):
			variant = int(marker.get_meta("variant"))
		visual.call("set_variant", variant)
	if invader.has_signal("health_depleted"):
		invader.connect("health_depleted", _on_invader_defeated.bind(invader))

## 站位来自蓝图（`E` → `EnemySpawn0..n`，由 `gen_room_terrain.gd` 生成并吸附到地面）。
##
## 回退分支保留旧公式，但它**落在地面上是巧合**：`y=568` 是按老地面 600 推的，
## 地面抬到 624 之后敌人会浮空 31px。所以回退只用于"还没迁移到蓝图的房间"，
## 且只在找不到 marker 时触发 —— 不要再往里加新房间。
func _invader_spawn_pos(index: int) -> Vector2:
	var marker: Node2D = get_node_or_null("EnemySpawn%d" % index) as Node2D
	if marker != null:
		return marker.position
	if index == 0:
		push_warning("%s 没有 EnemySpawn 标记，回退到旧写死坐标 —— 请把站位补进蓝图" % scene_file_path)
	return Vector2(660.0 + index * 90.0, 568.0)

func _on_invader_defeated(invader: Area2D) -> void:
	# queue_free 在帧末才生效，call_deferred 检查时计数仍含将死节点。
	# 改为同步 remove_child，让存活计数立即准确，再同步判定是否清场。
	if is_instance_valid(invader) and invader.get_parent() == invaders_container:
		invaders_container.remove_child(invader)
		invader.queue_free()
	_check_all_invaders_defeated()

func _check_all_invaders_defeated() -> void:
	if not is_instance_valid(invaders_container):
		return
	if invaders_container.get_child_count() > 0:
		return
	if not WorldState.invaded_rooms.has(room_id):
		return

	_play_purify_wipe()
	WorldState.purify_room(room_id)
	# 门开 = 「所以我现在可以走了」。这一句比光效重要得多。
	_set_exit_doors_locked(false)
	_announce_purified()

func _play_purify_wipe() -> void:
	var mat: ShaderMaterial = filter_rect.material as ShaderMaterial
	if mat == null:
		return
	if _purify_tween != null and _purify_tween.is_valid():
		_purify_tween.kill()

	# 彩色波纹从主角当前屏幕位置扩散（canvas transform → 屏幕 UV）
	var screen_pos: Vector2 = get_viewport().get_canvas_transform() * player.global_position
	var viewport_size: Vector2 = get_viewport_rect().size
	var uv: Vector2 = Vector2(
		clampf(screen_pos.x / viewport_size.x, 0.0, 1.0),
		clampf(screen_pos.y / viewport_size.y, 0.0, 1.0)
	)
	mat.set_shader_parameter("wipe_center", uv)
	mat.set_shader_parameter("wipe_radius", 0.0)

	_purify_tween = create_tween()
	_purify_tween.tween_property(mat, "shader_parameter/wipe_radius", purify_radius, purify_tween_duration).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_purify_tween.tween_callback(func() -> void:
		mat.set_shader_parameter("desaturate_amount", 0.0)
	)
	# 紫月同时退去。两条 tween 各管一个 uniform，并行跑互不干扰。
	_set_env_night(0.0, purify_tween_duration)
