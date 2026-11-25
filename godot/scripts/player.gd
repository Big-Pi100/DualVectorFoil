extends CharacterBody2D
## 玩家控制器 —— 从 web 原型 `src/game.js` 移植。
##
## 手感参数**逐字照抄** aos 预设（L70-92）。这些数字不是调出来的，是
## 按《晓月圆舞曲》反编译数据换算的，改动前先读 STYLE_LOCK / S1_S3_REPORT。
##
## 坐标约定：节点原点 = **脚底中心**。碰撞盒在原点上方，精灵也向上偏移。

# ── 手感参数（aos 预设，逐字照抄）─────────────────────────────
const SPD_RUN := 270.0       # 1.5 px/帧 × 3 × 60
const SPD_AIR := 270.0       # 跳跃期间水平速度不变
const P_GRAV := 2362.0       # 0.21875 px/帧² × 3 × 3600
const P_MAX_FALL := 1260.0   # 终速 FIX(7) = 7px/帧
const P_JUMP_V := 991.0      # 971.3 是 web 半隐式欧拉的标定值；Godot 积分器下少 8px，
                             # 按 √(203.8/195.8) 反算补到 991，实测见 tests/feel_smoke.gd
const P_DJUMP_V := 808.7     # 792.7 × 同比例
const FRIC_G := 1350.0       # 地面摩擦 0.125 px/帧² → 松手 10 帧才停
const FRIC_A := 675.0        # 空中摩擦是地面的一半

# 顶点滞空：窗口非对称 -22.5 ~ +67.5，窗口内按住跳键时重力 ×0.2
const APEX_LO := -22.5
const APEX_HI := 67.5
const APEX_MUL := 0.2
# 松手切断：上升速度直接压到 400（绝对值切断，不是乘系数）
const CUT_V := 400.0

const COYOTE_T := 0.0        # 恶魔城没有土狼时间
const JBUF_TICKS := 3        # 跳跃缓冲 3 个物理步 = 25ms
const MAX_JUMPS := 2

# ── 碰撞尺寸（照抄 P_W / P_H）──────────────────────────────
const BODY_W := 28.0
const BODY_H := 100.0

# ── 状态 ──────────────────────────────────────────────────
var jumps := 0
var coyote := 0.0
var jump_buf := 0.0
var cut_ok := false
var facing := 1

@onready var sprite: Sprite2D = $Sprite

# 状态 → (贴图路径, 帧数)。换图时重设 hframes。
const ANIM := {
	"stand":  ["res://assets/hero/hero_stand.png", 4],
	"walk":   ["res://assets/hero/hero_walk.png", 2],
	"jump":   ["res://assets/hero/hero_jump.png", 3],
	"fall":   ["res://assets/hero/hero_fall.png", 3],
	"crouch": ["res://assets/hero/hero_crouch.png", 2],
	"dash":   ["res://assets/hero/hero_dash.png", 3],
	"slide":  ["res://assets/hero/hero_slide.png", 3],
	"attack": ["res://assets/hero/hero_attack.png", 4],
	"hurt":   ["res://assets/hero/hero_hurt.png", 3],
	"cast":   ["res://assets/hero/hero_cast.png", 4],
}
var _cache: Dictionary = {}
var _cur_anim := ""


func _ready() -> void:
	for k in ANIM:
		_cache[k] = load(ANIM[k][0])
	_play("stand")


func _physics_process(delta: float) -> void:
	# ── 输入 ──
	var dir := 0
	if Input.is_action_pressed("move_left"):
		dir -= 1
	if Input.is_action_pressed("move_right"):
		dir += 1
	if dir != 0:
		facing = dir

	# ── 水平：aos 是"一帧到满速"，所以按下就是满速，松手才摩擦 ──
	var max_spd := SPD_RUN if is_on_floor() else SPD_AIR
	if dir != 0:
		velocity.x = dir * max_spd
	else:
		var fric := FRIC_G if is_on_floor() else FRIC_A
		var drop := fric * delta
		if abs(velocity.x) <= drop:
			velocity.x = 0.0
		else:
			velocity.x -= sign(velocity.x) * drop

	# ── 跳跃缓冲 ──
	if Input.is_action_just_pressed("jump"):
		jump_buf = JBUF_TICKS / 120.0
	else:
		jump_buf = maxf(0.0, jump_buf - delta)

	# ── 落地 / 离地 ──
	if is_on_floor():
		jumps = 0
		coyote = COYOTE_T
	else:
		coyote = maxf(0.0, coyote - delta)

	# ── 起跳：优先地面（含土狼），否则二段 ──
	if jump_buf > 0.0:
		if coyote > 0.0 or is_on_floor():
			_do_jump(P_JUMP_V)
			jumps = 1
			jump_buf = 0.0
		elif jumps < MAX_JUMPS:
			_do_jump(P_DJUMP_V)
			jumps = MAX_JUMPS
			jump_buf = 0.0

	# ── 松手切断（只在上升段生效，且只切一次）──
	if cut_ok and velocity.y < 0.0 and not Input.is_action_pressed("jump"):
		if velocity.y < -CUT_V:
			velocity.y = -CUT_V
		cut_ok = false

	# ── 重力：顶点窗口内按住跳键则打折 ──
	var g := P_GRAV
	if velocity.y > APEX_LO and velocity.y < APEX_HI and Input.is_action_pressed("jump"):
		g *= APEX_MUL
	velocity.y = minf(velocity.y + g * delta, P_MAX_FALL)

	# ── 移动 ──
	move_and_slide()

	_update_anim()


func _do_jump(v: float) -> void:
	velocity.y = -v
	cut_ok = true


func _update_anim() -> void:
	var a := "stand"
	if not is_on_floor():
		a = "jump" if velocity.y < 0.0 else "fall"
	elif Input.is_action_pressed("crouch"):
		a = "crouch"
	elif absf(velocity.x) > 8.0:
		a = "walk"
	_play(a)


func _play(a: String) -> void:
	if a == _cur_anim:
		return
	_cur_anim = a
	sprite.texture = _cache[a]
	sprite.hframes = ANIM[a][1]
	sprite.frame = 0
	sprite.flip_h = facing < 0
