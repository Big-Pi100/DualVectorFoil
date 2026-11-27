extends SceneTree

## S2 闸门：折叠（二段跳）真的被锁住了吗？
##
## 这套要防的不是"二段跳能不能跳"，而是**"没解锁时能不能跳"**。
## S2 之前 `can_double_jump` 初值写死 `true`、落地无条件充能，
## 于是折叠这个能力在系统里存在、在 UI 上从没出现过、在玩法上从不缺席。
## 那种"能力"等于没有 —— 而且它不会让任何既有测试变红。
##
## 判据分两层，缺一不可：
##   A 设计前提：240px 的台，单跳上不去（否则折叠点根本不是折叠点）
##   B 锁本身  ：未解锁时按第二下 → 上不去台的**同时** vy 不许突变
##              解锁后同一操作 → 必须上去
## 只测 B 的一半（"按了没反应"）是不够的：按键坏了、输入被吞了、
## 时序不对，都会让"没反应"成立。所以必须配一条"解锁后同样的操作就上去了"。
##
## 用法：godot --headless --path godot --script res://tests/test_fold_lock.gd

const ROOM_PATH: String = "res://world/rooms/Room03.tscn"
## 原点在**脚底**：站地面时 global_position.y 就等于站立面的 y（实测 624/384），
## 不是 600/360。第一版按"碰撞盒中心"假设写，量出来差 24px，直接判 FAIL。
const GROUND_Y: float = 624.0
const PLATFORM_STAND_Y: float = 384.0

const ABILITY_X: float = 472.0        # 蓝图 c9：纸片所在列（台左侧空地，避开 vista 标签与 HUD）
const OPEN_X: float = 424.0           # 蓝图 c8：头顶全空，测跳跃高度只能在这里
const UNDER_X: float = 712.0          # 蓝图 c14：高台正下方（用来证明会撞头）
const PLATFORM_X: float = 664.0       # 蓝图 c13：台面中心
const EDGE_X: float = 568.0           # 蓝图 c11：台左边缘外一格，起跳点
const PLATFORM_LEFT_X: float = 592.0  # 台左缘（c12 左边线）

var _fail: int = 0
var _root: Node

func _initialize() -> void:
	_root = root
	# `_initialize` 阶段 root 还没进 "active scene tree"，这时连 `/root/xxx`
	# 这种绝对路径都不许取（"Can't use get_node() with absolute paths"）。
	# 等一帧再开始，autoload 也就位了。
	await process_frame
	await _run()

func _check(ok: bool, msg: String) -> void:
	if ok:
		print("  ok   %s" % msg)
	else:
		_fail += 1
		print("  FAIL %s" % msg)

## Godot 4.7 里 `bool()` / `float()` 不能当全局构造器调（Nonexistent constructor），
## 而 `get()` 出来的都是 Variant。统一走显式类型标注转换。
func _f(v: Variant) -> float:
	var out: float = v
	return out

## `get("is_on_floor")` 拿到的是**方法 Callable**，不是布尔 —— 必须走 call()。
## 同理 `get("velocity.y")` 永远是 null：velocity 是一个 Vector2 属性，没有 .y 子键。
func _on_floor(p: Node2D) -> bool:
	var r: Variant = p.call("is_on_floor")
	return r == true

func _vy(p: Node2D) -> float:
	var v: Vector2 = p.get("velocity")
	return v.y

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

## `--script` 模式下 autoload 的全局名在编译期还没注册，只能走 /root 取节点。
func _world_state() -> Node:
	var n: Node = _root.get_node_or_null("WorldState")
	if n == null:
		n = _root.get_node_or_null("/root/WorldState")
	return n

func _load_room() -> Node2D:
	var ps: PackedScene = load(ROOM_PATH) as PackedScene
	if ps == null:
		return null
	var room: Node2D = ps.instantiate() as Node2D
	_root.add_child(room)
	return room

## 敌人会打断测量（打到人就有硬直与击退），闸门只关心跳跃，先把它们清掉。
func _clear_invaders(room: Node) -> void:
	var box: Node = room.get_node_or_null("InvadersContainer")
	if box == null:
		return
	for c: Node in box.get_children():
		c.queue_free()

## 把玩家挪到某点上方，等它落稳，返回站定后的原点 y。
func _settle_at(player: Node2D, pos: Vector2, settle_frames: int = 90) -> float:
	player.global_position = pos
	player.set("velocity", Vector2.ZERO)
	for i: int in range(settle_frames):
		await physics_frame
		if _on_floor(player) and absf(_vy(player)) < 1.0:
			break
	return player.global_position.y

## 起跳并在顶点附近补按一次跳。返回 {apex_y, vy_after_second, landed_y}。
## 第二下按在顶点，是为了让"二段生效"和"没生效"的 vy 差得足够远：
## 顶点 vy≈0，二段立刻把 vy 拉到 -697；没有二段就继续 +760 下落。
func _jump_with_second_press(player: Node2D, press_second: bool, hold_right: bool = false) -> Dictionary:
	if hold_right:
		Input.action_press("move_right")
	Input.action_press("jump")
	await _frames(2)
	Input.action_release("jump")
	await _frames(26)   # 约 0.43s，接近单跳顶点
	var vy_at_apex: float = _vy(player)
	if press_second:
		Input.action_press("jump")
		await _frames(2)
		Input.action_release("jump")
	var vy_after: float = _vy(player)

	var apex_y: float = player.global_position.y
	for i: int in range(150):
		await physics_frame
		apex_y = minf(apex_y, player.global_position.y)
		if i > 10 and _on_floor(player) and absf(_vy(player)) < 1.0:
			break
	if hold_right:
		Input.action_release("move_right")
	return {
		"apex_y": apex_y,
		"vy_at_apex": vy_at_apex,
		"vy_after_second": vy_after,
		"landed_y": player.global_position.y,
		"landed_x": player.global_position.x,
	}

func _run() -> void:
	print("--- S2 折叠上锁闸门 ---")
	var ws: Node = _world_state()
	ws.call("reset_state")

	# ===== A. 干净状态 =====
	print("\n[A] 新游戏没有折叠")
	_check(ws.call("has_ability", "fold") != true, "reset_state 后 has_ability(fold) 应为 false")

	var room: Node2D = _load_room()
	_check(room != null, "%s 可加载" % ROOM_PATH)
	if room == null:
		_finish()
		return
	await _frames(4)
	_clear_invaders(room)

	var player: Node2D = room.get_node_or_null("Player") as Node2D
	_check(player != null, "Room03 里有 Player")
	if player == null:
		_finish()
		return

	# ===== B. 设计前提：两个站面的高度差 =====
	print("\n[B] 台面确实单跳够不到（这是折叠点成立的前提）")
	var ground_stand: float = await _settle_at(player, Vector2(ABILITY_X, GROUND_Y))
	var plat_stand: float = await _settle_at(player, Vector2(PLATFORM_X, PLATFORM_STAND_Y))
	_check(absf(ground_stand - GROUND_Y) < 8.0, "地面站定 y=%.1f（期望 %.0f）" % [ground_stand, GROUND_Y])
	_check(absf(plat_stand - PLATFORM_STAND_Y) < 8.0,
		"台面站定 y=%.1f（期望 %.0f）—— 量不到就该怀疑地形被改过" % [plat_stand, PLATFORM_STAND_Y])
	var rise: float = ground_stand - plat_stand
	print("  两个站面差 %.1f px（%.2f 格）" % [rise, rise / 48.0])
	_check(rise > 210.0 and rise < 340.0,
		"落差 %.0f 落在「单跳 211.6 上不去、二段 331.1 上得去」的窗口里" % rise)

	# 台底下起跳会被顶回来 —— 这条不是废话，它正是纸片不能放在台正下方的原因
	var under_stand: float = await _settle_at(player, Vector2(UNDER_X, GROUND_Y))
	var head: Dictionary = await _jump_with_second_press(player, true)
	var head_rise: float = under_stand - _f(head["apex_y"])
	print("  台正下方起跳只能升 %.1f px（台上空 %0.f px）" % [head_rise, rise])
	_check(head_rise < rise - 100.0,
		"台底净空不足：在台正下方跳只升 %.0f px 就撞头，所以「捡到折叠原地试跳」试不出来" % head_rise)

	# ===== C. 锁本身：未解锁时补按第二下 =====
	print("\n[C] 未解锁折叠：补按第二下不该有任何效果")
	await _settle_at(player, Vector2(OPEN_X, GROUND_Y))
	var locked: Dictionary = await _jump_with_second_press(player, true)
	var locked_rise: float = ground_stand - _f(locked["apex_y"])
	print("  升幅 %.1f px  vy@顶点=%.1f  vy@补按后=%.1f  落点 y=%.1f"
		% [locked_rise, _f(locked["vy_at_apex"]), _f(locked["vy_after_second"]), _f(locked["landed_y"])])
	_check(_f(locked["vy_after_second"]) > -400.0,
		"补按后 vy 仍朝下（%.1f），第二段没被触发" % _f(locked["vy_after_second"]))
	_check(locked_rise < rise - 20.0,
		"未解锁时最高只升 %.0f px，够不到 %.0f px 的台" % [locked_rise, rise])

	# ===== D. 拾取链路 =====
	print("\n[D] 台底的纸片：提示 → 按 U → 解锁")
	var pickup: Node2D = room.get_node_or_null("AbilityPickup0") as Node2D
	_check(pickup != null, "Room03 有 AbilityPickup0（蓝图 A 生成）")
	if pickup == null:
		_finish_with_room(room)
		return
	_check(str(pickup.get("ability_id")) == "fold",
		"纸片绑的是 fold（实际 %s）" % str(pickup.get("ability_id")))

	await _settle_at(player, Vector2(ABILITY_X, GROUND_Y))
	await _frames(6)   # Area2D 的 body_entered 要等物理步
	var prompt: Label = pickup.get_node_or_null("PromptLabel") as Label
	_check(prompt != null and prompt.visible, "靠近后出现拾取提示")
	_check(prompt != null and prompt.text.contains("折叠"), "提示里写了能力名")

	Input.action_press("interact")
	await _frames(2)
	Input.action_release("interact")
	await _frames(4)
	_check(ws.call("has_ability", "fold") == true, "按 U 后 WorldState 记下了 fold")
	_check(pickup.get("monitoring") != true, "拾取后不再监听（防止重复拿）")

	# ===== E. 解锁后：真的能上那个台（端到端，不是"高度够"） =====
	print("\n[E] 解锁后：从台边起跳 + 前移，应该落到台上")
	await _settle_at(player, Vector2(EDGE_X, GROUND_Y))
	var jumped: Dictionary = await _jump_with_second_press(player, true, true)
	print("  补按后 vy=%.1f  落点 (%.1f, %.1f)"
		% [_f(jumped["vy_after_second"]), _f(jumped["landed_x"]), _f(jumped["landed_y"])])
	_check(_f(jumped["vy_after_second"]) < -400.0,
		"补按后 vy 翻向上了（%.1f），二段真的触发" % _f(jumped["vy_after_second"]))
	_check(absf(_f(jumped["landed_y"]) - plat_stand) < 12.0,
		"落点 y=%.1f 就在台面（%.1f）—— 折叠解锁后这个台才够得到"
		% [_f(jumped["landed_y"]), plat_stand])
	_check(_f(jumped["landed_x"]) > PLATFORM_LEFT_X,
		"落点 x=%.1f 已在台范围内（台左缘 %.0f）" % [_f(jumped["landed_x"]), PLATFORM_LEFT_X])

	# ===== F. 重进房间不重复刷纸片 =====
	print("\n[F] 已经拥有折叠时重进房间：纸片不该再出现")
	room.queue_free()
	await _frames(4)
	var room2: Node2D = _load_room()
	_check(room2 != null, "重进 Room03 可加载")
	if room2 != null:
		await _frames(4)
		var pickup2: Node2D = room2.get_node_or_null("AbilityPickup0") as Node2D
		_check(pickup2 != null, "节点还在（由蓝图生成，不靠运行时删）")
		if pickup2 != null:
			_check(not pickup2.visible, "但它已隐藏 —— 不会让玩家再捡一次")

	_finish_with_room(room2)

func _finish_with_room(room: Node) -> void:
	if room != null and is_instance_valid(room):
		room.queue_free()
	_finish()

func _finish() -> void:
	print("\nFOLD GATE: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)
