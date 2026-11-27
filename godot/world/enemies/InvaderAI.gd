class_name InvaderAI
extends Node

## 入侵者行为机：巡逻 / 察觉 / 追击 / 起手 / 判定 / 后摇 / 硬直。
##
## 为什么挂成子节点而不是改根脚本：
##   根节点是 `Hurtbox`（受击组件的通用契约，玩家攻击靠它接住伤害）。
##   给它塞 AI 会让「受击组件」变成「敌人实体」，以后任何可受伤物都得长一个敌人。
##   所以 AI 作为兄弟节点存在，读写父节点位置，互不越界。
##
## 为什么不用 CharacterBody2D：
##   根必须是 Area2D，玩家 Hitbox 的 `area_entered` 才认得它。改成物理体等于拆掉攻击判定。
##   地形是轴对齐网格，用射线做地面吸附 / 撞墙 / 悬崖判定足够，且和 Canvas 基线同构。

enum State { PATROL, CHASE, WINDUP, ACTIVE, RECOVER, HURT, DEAD }

## 地形 = world(1) + one_way_platform(2)。不含 enemy(3)：否则射线会打到自己。
const TERRAIN_MASK: int = 3
## 地面单位的下落加速度。不是"能跳"，是"被击退打下去之后会落地"。
## 没有它的话，敌人一旦离开台面就会停在半空——静止画面看不出来，动起来很荒诞。
const GRAVITY: float = 1600.0

## 数值来源：docs/gdd/10 §3.1 的表，除了基线抄来的三个，其余是建议值，
## S0 出口要实测一轮再定稿。别在这里凭手感改。
@export var patrol_speed: float = 55.0
@export var chase_speed: float = 60.0
@export var detect_radius: float = 320.0
@export var attack_range: float = 60.0
@export var damage: float = 18.0
@export var windup_time: float = 0.45
@export var active_time: float = 0.12
@export var recover_time: float = 0.5
@export var cooldown_time: float = 1.2
@export var hurt_stun_time: float = 0.2
## 巡逻范围（以出生点为中心的半宽）。基线是蓝图给的 min/max，这里用半宽近似。
@export var patrol_half_width: float = 96.0

signal state_changed(from: int, to: int)
signal attack_hit(player: Node)

var state: int = State.PATROL
var facing: float = -1.0

## 是否已被房间唤醒。
##
## 为什么需要它：Dead Cells 的房间是「一次遭遇」—— 进门锁门，全场敌人一起压上来。
## 只靠 `detect_radius`（320px）的话，一间 1920px 宽的房间会被切成 6 段，
## 玩家一个个走过去打，每次只面对 1 只，实测 12 秒无损清场 —— 那不是战斗，是收割。
## 房间在入侵开始时调用 `alert()`，等于宣布「这间房的仗开始了」。
var _alerted: bool = false

var _t: float = 0.0
var _state_t: float = 0.0
var _cooldown_t: float = 0.0
var _hurt_t: float = 0.0
var _hit_done: bool = false
var _kb_vx: float = 0.0
var _fall_v: float = 0.0

var _body: Area2D = null
var _shape: CollisionShape2D = null
var _visual: Sprite2D = null
var _half: Vector2 = Vector2(20.0, 25.0)
var _spawn: Vector2 = Vector2.ZERO
var _target: Node2D = null


func _ready() -> void:
	_body = get_parent() as Area2D
	if _body == null:
		push_error("InvaderAI 必须挂在 Area2D 下")
		set_physics_process(false)
		return
	_shape = _body.get_node_or_null("CollisionShape2D") as CollisionShape2D
	_visual = _body.get_node_or_null("Visual") as Sprite2D
	if _shape != null and _shape.shape is RectangleShape2D:
		_half = (_shape.shape as RectangleShape2D).size * 0.5
	_spawn = _body.position
	# 受击硬直 + 打断起手：信号是唯一入口，AI 不轮询血量。
	# `damaged` 在 Hurtbox 里先扣血再发信号，所以这里读到的 current_health 已是新值。
	if _body.has_signal("damaged"):
		_body.connect("damaged", _on_damaged)
	if _body.has_signal("health_depleted"):
		_body.connect("health_depleted", _on_depleted)


## 显式注入目标（测试用）。运行时由 `_find_target()` 自动找房间里的 Player。
func set_target(node: Node2D) -> void:
	_target = node


## 房间入侵开始时调用：无视察觉半径，直接进入追击。
## 只唤醒一次，之后行为完全一样（还是走 CHASE/WINDUP/...，不改战斗逻辑）。
func alert() -> void:
	_alerted = true
	if _target == null:
		_target = _find_target()
	if state == State.PATROL:
		_set_state(State.CHASE)


func is_flying() -> bool:
	if _visual != null and _visual.has_method("get") and _visual.get("variant") != null:
		return int(_visual.get("variant")) == 2
	return false


func get_state_name() -> String:
	return State.keys()[state]


func _physics_process(delta: float) -> void:
	if _body == null or state == State.DEAD:
		return
	_t += delta
	_state_t += delta
	if _cooldown_t > 0.0:
		_cooldown_t = maxf(0.0, _cooldown_t - delta)

	if _hurt_t > 0.0:
		_hurt_t = maxf(0.0, _hurt_t - delta)
		_apply_knockback(delta)
		_apply_posture(delta)
		if _hurt_t <= 0.0:
			_set_state(State.CHASE if _player() != null else State.PATROL)
		return

	var p: Node2D = _player()
	match state:
		State.PATROL:
			_do_patrol(delta, p)
		State.CHASE:
			_do_chase(delta, p)
		State.WINDUP:
			_do_windup(delta, p)
		State.ACTIVE:
			_do_active(delta, p)
		State.RECOVER:
			_do_recover(delta)
	if not is_flying():
		_apply_gravity(delta)
	_apply_posture(delta)


# ---------------------------- 各状态 ----------------------------

func _do_patrol(delta: float, p: Node2D) -> void:
	if _in_detect(p):
		_set_state(State.CHASE)
		return
	# 巡逻边界（以出生点为中心）
	if _body.position.x < _spawn.x - patrol_half_width:
		facing = 1.0
	elif _body.position.x > _spawn.x + patrol_half_width:
		facing = -1.0
	_walk(delta, patrol_speed)


func _do_chase(delta: float, p: Node2D) -> void:
	if p == null:
		_set_state(State.PATROL)
		return
	var dx: float = p.global_position.x - _body.global_position.x
	var dy: float = p.global_position.y - _body.global_position.y
	# 已经宣战就不脱战：否则玩家跑到房间另一头，敌人会自己走回去，
	# "一次遭遇"又会退化成"一段一段清"。
	if not _alerted and absf(dx) > detect_radius * 1.2:
		_set_state(State.PATROL)
		return

	if absf(dx) <= attack_range and absf(dy) <= 56.0 and _cooldown_t <= 0.0:
		facing = signf(dx) if absf(dx) > 0.01 else facing
		_set_state(State.WINDUP)
		return

	facing = signf(dx) if absf(dx) > 0.01 else facing
	if is_flying():
		_fly(delta, p)
	else:
		_walk(delta, chase_speed)


func _do_windup(_delta: float, p: Node2D) -> void:
	# 起手期不移动：这是「它要打你了」的承诺，动起来承诺就废了。
	if p != null:
		var dx: float = p.global_position.x - _body.global_position.x
		facing = signf(dx) if absf(dx) > 0.01 else facing
	if _state_t >= windup_time:
		_hit_done = false
		_set_state(State.ACTIVE)


func _do_active(_delta: float, p: Node2D) -> void:
	# 判定窗口只有 120ms，每次挥击只结一次账（_hit_done），
	# 否则一个起手会连扣 7 帧 = 玩家看见掉一次血、实际掉了 126。
	if not _hit_done and p != null:
		var dx: float = p.global_position.x - _body.global_position.x
		var dy: float = p.global_position.y - _body.global_position.y
		if absf(dx) <= attack_range + 14.0 and absf(dy) <= 56.0:
			_hit_done = true
			_strike(p, dx)
	if _state_t >= active_time:
		_cooldown_t = cooldown_time
		_set_state(State.RECOVER)


func _do_recover(_delta: float) -> void:
	if _state_t >= recover_time:
		_set_state(State.CHASE if _player() != null else State.PATROL)


# ---------------------------- 动作 ----------------------------

func _walk(delta: float, speed: float) -> void:
	if not _can_walk(facing):
		facing = -facing
		return
	_body.position.x += facing * speed * delta


## 前方能不能走：先看有没有墙，再看有没有地。缺一不可 ——
## 只查墙的话敌人会从平台边缘走下去，掉到下一层后永远回不来（S0 不做跳跃）。
func _can_walk(dir: float) -> bool:
	var from: Vector2 = _body.global_position + Vector2(dir * (_half.x + 2.0), -_half.y * 0.4)
	if _ray(from, Vector2(dir, 0.0), 6.0):
		return false
	var foot: Vector2 = _body.global_position + Vector2(dir * (_half.x + 2.0), _half.y - 2.0)
	if not _ray(foot, Vector2.DOWN, 40.0):
		return false
	return true


## 贴地优先：脚下 48px 内有地就直接吸附（避免在斜坡/台阶上抖），没有就自由下落。
## 吸附而不是"用重力慢慢落"，是因为逐帧重力会让敌人在地面上抖动 1px。
func _apply_gravity(delta: float) -> void:
	var hit: Dictionary = _ray(_body.global_position, Vector2.DOWN, _half.y + 48.0)
	if not hit.is_empty():
		_body.position.y = (hit["position"] as Vector2).y - _half.y
		_fall_v = 0.0
		return
	_fall_v = minf(_fall_v + GRAVITY * delta, 900.0)
	_body.position.y += _fall_v * delta


func _fly(delta: float, p: Node2D) -> void:
	# 基线：正弦上下飘 + 察觉后水平靠近，不做地面吸附。
	var hover_y: float = _spawn.y + sin(_t * 2.2) * 40.0
	_body.position.y = lerpf(_body.position.y, hover_y, minf(1.0, delta * 4.0))
	if p != null and (_alerted or absf(p.global_position.x - _body.global_position.x) < detect_radius):
		_body.position.x += facing * chase_speed * delta


func _strike(p: Node2D, dx: float) -> void:
	var dir: float = signf(dx) if absf(dx) > 0.01 else facing
	# 和 Hitbox 同约定：knockback.x > 0 表示「攻击来自左侧」。
	if p.has_method("take_damage"):
		p.call("take_damage", damage, Vector2(dir * 200.0, -120.0))
	attack_hit.emit(p)


func _apply_knockback(delta: float) -> void:
	if absf(_kb_vx) < 1.0:
		_kb_vx = 0.0
		return
	_body.position.x += _kb_vx * delta
	_kb_vx = move_toward(_kb_vx, 0.0, 900.0 * delta)


# ---------------------------- 形变（可读性） ----------------------------

## 起手不能用颜色表达 —— `06 §5` 要求玩家在关掉音效时也能看出来。
## 这里用「压扁 + 后仰」：起手瞬间横向变宽、纵向变矮、整体往后退 6px；
## 判定帧反过来「拉长 + 前扑」。纯几何，灰度截图也认得出来。
func _apply_posture(delta: float) -> void:
	if _visual == null:
		return
	var want := Vector2.ONE
	var want_x: float = 0.0
	match state:
		State.WINDUP:
			var k: float = clampf(_state_t / maxf(windup_time, 0.01), 0.0, 1.0)
			want = Vector2(lerpf(1.0, 1.28, k), lerpf(1.0, 0.76, k))
			want_x = -facing * 6.0 * k
		State.ACTIVE:
			want = Vector2(0.9, 1.18)
			want_x = facing * 10.0
		_:
			want = Vector2.ONE
			want_x = 0.0
	_visual.scale = _visual.scale.lerp(want, minf(1.0, delta * 18.0))
	_visual.position.x = lerpf(_visual.position.x, want_x, minf(1.0, delta * 18.0))
	if _visual is Sprite2D:
		(_visual as Sprite2D).flip_h = facing > 0.0


# ---------------------------- 信号 ----------------------------

func _on_damaged(_amount: float, knockback: Vector2) -> void:
	if state == State.DEAD:
		return
	# 硬直打断起手，但**打断不了后摇**：后摇是玩家主动出手换来的奖励，
	# 打一下就把奖励取消掉，等于「越打越安全」，比不打还怪。
	if state != State.RECOVER:
		_set_state(State.HURT)
	_hurt_t = hurt_stun_time
	_kb_vx = knockback.x * 0.6
	if _body != null and _body.has_method("get") and _body.get("current_health") != null:
		if float(_body.get("current_health")) <= 0.0:
			_set_state(State.DEAD)


func _on_depleted() -> void:
	_set_state(State.DEAD)


# ---------------------------- 工具 ----------------------------

func _set_state(next: int) -> void:
	if state == next:
		return
	var prev: int = state
	state = next
	_state_t = 0.0
	if next == State.WINDUP:
		_hit_done = false
	state_changed.emit(prev, next)


func _player() -> Node2D:
	if _target != null and is_instance_valid(_target):
		return _target
	_target = _find_target()
	return _target


func _find_target() -> Node2D:
	# 房间结构：Room/InvadersContainer/Invader/AI → 上溯两级拿房间根。
	var room: Node = _body.get_parent()
	if room != null:
		room = room.get_parent()
	if room != null:
		var p: Node = room.get_node_or_null("Player")
		if p is Node2D:
			return p as Node2D
	return null


func _in_detect(p: Node2D) -> bool:
	if p == null:
		return false
	if _alerted:
		return true
	var d: Vector2 = p.global_position - _body.global_position
	return absf(d.x) <= detect_radius and absf(d.y) <= 120.0


func _ray(from: Vector2, dir: Vector2, dist: float) -> Dictionary:
	var world: World2D = _body.get_world_2d()
	if world == null:
		return {}
	var q: PhysicsRayQueryParameters2D = PhysicsRayQueryParameters2D.create(
		from, from + dir.normalized() * dist, TERRAIN_MASK)
	q.collide_with_areas = false
	q.collide_with_bodies = true
	# 玩家和敌人同在世界层（layer 1），不排除就会把玩家当成地板/墙。
	var p: Node2D = _player()
	if p is CollisionObject2D:
		q.exclude = [(p as CollisionObject2D).get_rid()]
	return world.direct_space_state.intersect_ray(q)
