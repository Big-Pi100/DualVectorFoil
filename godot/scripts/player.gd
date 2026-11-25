extends CharacterBody2D
## 玩家控制器 —— 从 web 原型 `src/game.js` 移植。
##
## 坐标约定：节点原点 = **脚底中心**。碰撞盒在原点上方，精灵也向上偏移。
##
## ── 两套预设，游戏内 F1 / F2 热切换 ────────────────────────
##   F1 = "aos"    ：本项目定版。数值逐字照抄 aos 预设（L70-92），
##                   不是调出来的，是按《晓月圆舞曲》反编译数据换算的。
##   F2 = "crayon" ：《色彩旅人 / Crayon Odyssey》GDD 第三部分那份参考实现，
##                   逐字抄其 @export 值（280 / 2200 / 2400 / -480 / -420 /
##                   gravity_scale 1.35 / 750 / 0.14 / 0.15 / 460 / 0.26 / 0.25）。
##                   只用于对比试手感，**不是**要替换 F1。
##
## 两套的差别不只是数字，还有**模型**：aos 是"一帧到满速 + 松手摩擦"，
## crayon 是"加速到满速（2200 px/s²）+ 减速（2400）"。所以 accel=0 表示
## 前者，非 0 表示后者 —— 只抄数字不抄模型，280 配一帧到满速是另一种手。
##
## 手感冒烟：godot --headless --path godot --script res://tests/feel_smoke.gd

# ── 预设表 ────────────────────────────────────────────────
# 每一项都能在 STYLE_LOCK / OTHERS_GDD_REVIEW 里找到出处。
var PRESETS: Dictionary = {
	"aos": {
		"label": "AOS BASE",
		"spd_run": 270.0,        # 1.5 px/帧 × 3 × 60
		"spd_air": 270.0,        # 跳跃期间水平速度不变
		"accel": 0.0,            # 0 = 一帧到满速（aos 没有加速过程）
		"fric_g": 1350.0,        # 0.125 px/帧² → 松手 10 帧才停
		"fric_a": 675.0,         # 空中摩擦是地面的一半
		"grav": 2362.0,          # 0.21875 px/帧² × 3 × 3600
		"max_fall": 1260.0,      # 终速 FIX(7) = 7px/帧
		"jump_v": 991.0,         # 971.3 是 web 半隐式欧拉的标定值；Godot 积分器下少 8px，
		                         # 按 √(203.8/195.8) 反算补到 991，实测见 tests/feel_smoke.gd
		"djump_v": 808.7,        # 792.7 × 同比例
		"coyote": 0.0,           # 恶魔城没有土狼时间
		"jbuf": 0.025,           # 3 个物理步 = 25ms
		"abuf": 0.02,            # 后跃没有输入缓冲，按下即出
		"max_jumps": 2,
		"apex": true,            # 顶点滞空：窗口 -22.5 ~ +67.5，按住跳键重力 ×0.2
		"apex_lo": -22.5,
		"apex_hi": 67.5,
		"apex_mul": 0.2,
		"cut": true,             # 松手切断：上升速度直接压到 400（绝对值，不是乘系数）
		"cut_v": 400.0,
		"roll_kind": "backstep", # 原版 Backstep：朝背后弹开，不能转向
		"roll_spd": 560.0,
		"roll_dur": 0.20,
		"roll_inv": 0.12,        # 无敌只覆盖前 60%，不是白给
		"roll_cd": 0.0,
		"roll_decel": 1600.0,
		"hitstop": 0.045,
	},
	"crayon": {
		"label": "CRAYON REF",
		"spd_run": 280.0,        # move_speed
		"spd_air": 280.0,        # 文档只有 move_speed，空中不另设
		"accel": 2200.0,         # acceleration
		"fric_g": 2400.0,        # friction
		"fric_a": 2400.0,
		"grav": 1323.0,          # default_gravity 980 × gravity_scale 1.35
		"max_fall": 750.0,       # minf(velocity.y, 750.0)
		"jump_v": 480.0,         # jump_velocity
		"djump_v": 420.0,        # double_jump_velocity
		"coyote": 0.14,          # coyote_time
		"jbuf": 0.15,            # jump_buffer_time
		"abuf": 0.15,            # action_buffer_time
		"max_jumps": 2,
		"apex": false,           # 文档没有顶点滞空
		"apex_lo": 0.0,
		"apex_hi": 0.0,
		"apex_mul": 1.0,
		"cut": false,            # 文档没有松手切断：点一下也跳满
		"cut_v": 0.0,
		"roll_kind": "roll",     # 正向前滚，方向锁死
		"roll_spd": 460.0,       # roll_speed
		"roll_dur": 0.26,        # roll_duration
		"roll_inv": 0.26,        # 文档是全程无敌
		"roll_cd": 0.25,         # roll_cooldown
		"roll_decel": 0.0,
		"hitstop": 0.045,
	},
}

var preset_name := "aos"
var p: Dictionary = {}

# ── 状态 ──────────────────────────────────────────────────
var jumps := 0
var coyote := 0.0
var jump_buf := 0.0
var cut_ok := false
var facing := 1

# 翻滚 / 后跃
var roll_t := 0.0
var roll_cd := 0.0
var roll_buf := 0.0
var roll_dir := 1
var invuln := 0.0

# 试手感用的计量：本次跳跃最高点（离起跳位的像素数）
var peak_h := 0.0
var _base_y := 0.0
var _peak_live := false

const SPRITE_SCALE := 0.8

# ── 碰撞尺寸（照抄 P_W / P_H）──────────────────────────────
const BODY_W := 28.0
const BODY_H := 100.0

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
	apply_preset("aos")


## 切换预设。会清掉翻滚与跳跃缓冲，避免用旧预设的时长卡在新预设里。
func apply_preset(name: String) -> void:
	if not PRESETS.has(name):
		return
	preset_name = name
	p = PRESETS[name]
	jumps = 0
	coyote = 0.0
	jump_buf = 0.0
	roll_buf = 0.0
	roll_cd = 0.0
	cut_ok = false
	if roll_t > 0.0:
		_end_roll()
	peak_h = 0.0
	_peak_live = false


func is_invincible() -> bool:
	return invuln > 0.0


func _input(event: InputEvent) -> void:
	# 用 _input 而不是 _unhandled_key_input：HUD 是 Label，不消费输入，
	# 但将来加暂停菜单/对话框时会 consume，那时候 F1/F2 就调不出来了。
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo:
		return
	if k.keycode == KEY_F1:
		apply_preset("aos")
	elif k.keycode == KEY_F2:
		apply_preset("crayon")


func _physics_process(delta: float) -> void:
	# 顿帧：只冻自己，动画和粒子照常
	if Hitstop.frozen(self):
		return

	invuln = maxf(0.0, invuln - delta)
	roll_cd = maxf(0.0, roll_cd - delta)

	# ── 翻滚 / 后跃：接管水平轴，垂直轴仍吃重力 ──
	# 文档写的是 velocity.y = 0（空中翻滚会悬停 0.26s）；这里只在地面清零，
	# 空中继续下落 —— 悬停是 bug，不是手感。
	if roll_t > 0.0:
		roll_t = maxf(0.0, roll_t - delta)
		if p.roll_kind == "backstep":
			velocity.x = move_toward(velocity.x, 0.0, p.roll_decel * delta)
		else:
			velocity.x = roll_dir * p.roll_spd
		if is_on_floor():
			velocity.y = 0.0
		else:
			velocity.y = minf(velocity.y + p.grav * delta, p.max_fall)
		move_and_slide()
		_track_peak()
		_update_anim()
		if roll_t <= 0.0:
			_end_roll()
		return

	# ── 输入 ──
	var dir := 0
	if Input.is_action_pressed("move_left"):
		dir -= 1
	if Input.is_action_pressed("move_right"):
		dir += 1
	if dir != 0:
		facing = dir

	# ── 翻滚输入（F）──
	if Input.is_action_just_pressed("dash"):
		roll_buf = p.abuf
	else:
		roll_buf = maxf(0.0, roll_buf - delta)
	if roll_buf > 0.0 and roll_cd <= 0.0:
		_start_roll()
		roll_buf = 0.0

	# ── 水平 ──
	var max_spd: float = p.spd_run if is_on_floor() else p.spd_air
	if dir != 0:
		if p.accel > 0.0:
			velocity.x = move_toward(velocity.x, dir * max_spd, p.accel * delta)
		else:
			# aos 是"一帧到满速"，按下就是满速，松手才摩擦
			velocity.x = dir * max_spd
	else:
		var fric: float = p.fric_g if is_on_floor() else p.fric_a
		var drop := fric * delta
		if absf(velocity.x) <= drop:
			velocity.x = 0.0
		else:
			velocity.x -= sign(velocity.x) * drop

	# ── 跳跃缓冲 ──
	if Input.is_action_just_pressed("jump"):
		jump_buf = p.jbuf
	else:
		jump_buf = maxf(0.0, jump_buf - delta)

	# ── 落地 / 离地 ──
	if is_on_floor():
		jumps = 0
		coyote = p.coyote
	else:
		coyote = maxf(0.0, coyote - delta)

	# ── 起跳：优先地面（含土狼），否则二段 ──
	if jump_buf > 0.0:
		if coyote > 0.0 or is_on_floor():
			_do_jump(p.jump_v, true)
			jumps = 1
			coyote = 0.0
			jump_buf = 0.0
		elif jumps < int(p.max_jumps):
			_do_jump(p.djump_v, false)
			jumps = int(p.max_jumps)
			jump_buf = 0.0

	# ── 松手切断（只在上升段生效，且只切一次）──
	if cut_ok and velocity.y < 0.0 and not Input.is_action_pressed("jump"):
		if velocity.y < -p.cut_v:
			velocity.y = -p.cut_v
		cut_ok = false

	# ── 重力：顶点窗口内按住跳键则打折 ──
	var g: float = p.grav
	if p.apex and velocity.y > p.apex_lo and velocity.y < p.apex_hi and Input.is_action_pressed("jump"):
		g *= p.apex_mul
	velocity.y = minf(velocity.y + g * delta, p.max_fall)

	# ── 移动 ──
	move_and_slide()

	_track_peak()
	_update_anim()


func _do_jump(v: float, from_ground: bool) -> void:
	if from_ground:
		peak_h = 0.0
		_base_y = global_position.y
		_peak_live = true
	velocity.y = -v
	cut_ok = p.cut


func _start_roll() -> void:
	roll_t = p.roll_dur
	if p.roll_kind == "roll":
		# 文档的 _roll_cd_timer = roll_duration + roll_cooldown
		roll_cd = p.roll_dur + p.roll_cd
		roll_dir = facing
	else:
		roll_cd = 0.0            # backstep 靠 roll_t 独占，结束即可再用
		roll_dir = -facing
		velocity.x = roll_dir * p.roll_spd
		velocity.y = 0.0
	invuln = p.roll_inv
	cut_ok = false
	sprite.scale = Vector2(SPRITE_SCALE * 1.25, SPRITE_SCALE * 0.65)
	sprite.modulate.a = 0.6


func _end_roll() -> void:
	sprite.scale = Vector2(SPRITE_SCALE, SPRITE_SCALE)
	sprite.modulate.a = 1.0


func _track_peak() -> void:
	if not _peak_live:
		return
	peak_h = maxf(peak_h, _base_y - global_position.y)
	if is_on_floor() and velocity.y >= 0.0:
		_peak_live = false


func _update_anim() -> void:
	var a := "stand"
	if roll_t > 0.0:
		a = "dash"
	elif not is_on_floor():
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


## HUD 用：英文，避免默认字体缺中文变豆腐块。
func hud_text() -> String:
	var kind := "backstep" if p.roll_kind == "backstep" else "roll"
	return "PRESET  %s      [F1] AOS   [F2] CRAYON REF\njump %.0f  grav %.0f  fall %.0f   peak %.1f\nrun %.0f  %s  fric %.0f  coyote %.0fms  buf %.0fms\n%s %.0f x %.2fs  inv %.2fs   %s" % [
		p.label,
		p.jump_v, p.grav, p.max_fall, peak_h,
		p.spd_run,
		("accel %.0f" % p.accel) if p.accel > 0.0 else "instant",
		p.fric_g, p.coyote * 1000.0, p.jbuf * 1000.0,
		kind, p.roll_spd, p.roll_dur, p.roll_inv,
		"INVULN" if invuln > 0.0 else "",
	]
