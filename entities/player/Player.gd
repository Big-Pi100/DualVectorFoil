class_name Player
extends CharacterBody2D

## 《二向箔》主角控制器 —— 1:1 复刻《重生细胞》移动端核心手感。
## 动作集：二段跳 / 单向平台下穿 / 空中下砸 / 翻滚打断后摇 / 格挡 / 双技能 / 长按自动连招。
## 所有手感参数 @export；跨模块通信一律 Signal（AGENTS.md 铁律）。

signal health_changed(current_hp: float, max_hp: float)
signal skill_triggered(slot_index: int)
signal interact_requested()
signal respawn_requested()

@export_group("属性与生存（低挫败感基调）")
@export var max_hp: float = 120.0
@export var heal_amount: float = 45.0
@export var max_flasks: int = 3
@export var coyote_time: float = 0.14
@export var jump_buffer_time: float = 0.15
@export var action_buffer_time: float = 0.15

@export_group("移动、下穿与下砸")
@export var move_speed: float = 290.0
@export var acceleration: float = 2400.0
@export var friction: float = 2600.0
@export var jump_velocity: float = -490.0
@export var double_jump_velocity: float = -430.0
@export var dive_speed: float = 680.0
@export var gravity_scale: float = 1.35
@export var one_way_platform_layer: int = 2      # 单向平台所在的 2D 物理层编号（1-32）
@export var drop_through_duration: float = 0.22  # 下穿期间临时关闭单向平台碰撞层的时长

@export_group("动画表现（正式蜡笔资产）")
@export var hurt_anim_duration: float = 0.35   # 受击动画最短停留时间
@export var climb_anim_duration: float = 0.40  # 自动抓边攀爬动画停留时间

@export_group("翻滚、连招与格挡")
@export var roll_speed: float = 480.0
@export var roll_duration: float = 0.25
@export var roll_cooldown: float = 0.22
@export var combo_interval: float = 0.22
@export var parry_duration: float = 0.28
@export var parry_cooldown: float = 0.35
@export var attack_lunge_speed: float = 150.0   # 挥砍前冲速度
@export var attack_lunge_duration: float = 0.12 # 挥砍前冲持续时间
@export var base_attack_damage: float = 10.0    # 未加成的武器基础伤害

@onready var visuals: Node2D = $Visuals
@onready var sprite: AnimatedSprite2D = $Visuals/Sprite
@onready var sword_rect: ColorRect = $Visuals/WeaponPivot/SwordRect
@onready var shield_rect: ColorRect = $Visuals/WeaponPivot/ShieldRect
@onready var hitbox: Hitbox = $Visuals/WeaponPivot/Hitbox
@onready var dive_hitbox: Hitbox = $DiveHitbox
@onready var ledge_top: RayCast2D = $LedgeCheckTop
@onready var ledge_bottom: RayCast2D = $LedgeCheckBottom
@onready var camera: Camera2D = $Camera2D

var hp: float = 120.0
var flasks: int = 3
var facing_dir: float = 1.0
var _roll_dir: float = 1.0 # 翻滚方向快照：翻滚期间不受外部转向影响
var can_double_jump: bool = true

var is_rolling: bool = false
var is_invincible: bool = false
var is_attacking: bool = false
var is_diving: bool = false
var is_parrying: bool = false
var _attack_token: int = 0

# 无敌来源计数：翻滚 / 格挡 / 下砸可能重叠，任一结束不应提前清除别人的无敌
var _invincible_sources: Dictionary = {}

var _coyote_timer: float = 0.0
var _jump_buffer_timer: float = 0.0
var _roll_buffer_timer: float = 0.0
var _roll_cd_timer: float = 0.0
var _attack_cd_timer: float = 0.0
var _parry_cd_timer: float = 0.0
var _attack_lunge_timer: float = 0.0
var _is_dropping_through: bool = false
var _base_max_hp: float = -1.0 # 惰性捕获 @export 初始值，用于叠加作物加成

# 眺望演出：只驱动相机 zoom 与动画贴图，不锁输入、不碰手感判定
var _vista_active: bool = false
var _vista_zoom_tween: Tween = null

# 动画状态：只驱动贴图，不影响任何手感/判定逻辑
var _hurt_anim_timer: float = 0.0
var _climb_anim_timer: float = 0.0
var _current_anim: StringName = &""

# 外部 TouchHUD 注入的虚拟输入（与键盘并行，兼容测试直接置值）
var virtual_move_vector: Vector2 = Vector2.ZERO
var virtual_primary_held: bool = false

func _ready() -> void:
	if _base_max_hp < 0.0:
		_base_max_hp = max_hp
	hp = max_hp
	flasks = max_flasks
	sword_rect.visible = false
	shield_rect.visible = false
	_play_anim(&"idle")
	# 战力加成唯一数据源在 WorldState；新场景实例也要读一次并订阅后续变化
	if get_node_or_null("/root/WorldState") != null:
		WorldState.power_stat_changed.connect(_on_power_stat_changed)
		WorldState.vista_mode_changed.connect(_on_vista_mode_changed)
		apply_power_bonuses(WorldState.bonus_attack_damage, WorldState.bonus_max_hp)
	health_changed.emit(hp, max_hp)

func _on_power_stat_changed(_stat_name: String, _new_value: float) -> void:
	apply_power_bonuses(WorldState.bonus_attack_damage, WorldState.bonus_max_hp)

## 由 WorldState 的加成值同步到实体（公开接口，供 SoilPlot 收割后调用）
func apply_power_bonuses(attack_bonus: float, hp_bonus: float) -> void:
	if _base_max_hp < 0.0:
		_base_max_hp = max_hp
	var was_full: bool = is_equal_approx(hp, max_hp)
	hitbox.damage = base_attack_damage + attack_bonus
	dive_hitbox.damage = base_attack_damage + attack_bonus
	max_hp = _base_max_hp + hp_bonus
	hp = max_hp if was_full else minf(hp, max_hp)
	health_changed.emit(hp, max_hp)

func _exit_tree() -> void:
	# 兜底：下穿 await 期间若场景切换，避免碰撞层掩码永久关闭
	if _is_dropping_through:
		set_collision_mask_value(one_way_platform_layer, true)
		_is_dropping_through = false
	# 兜底：眺望 tween 未播完就切场景，相机 zoom 留在新场景会异常
	if _vista_zoom_tween != null and _vista_zoom_tween.is_valid():
		_vista_zoom_tween.kill()
	if get_node_or_null("/root/WorldState") != null:
		if WorldState.vista_mode_changed.is_connected(_on_vista_mode_changed):
			WorldState.vista_mode_changed.disconnect(_on_vista_mode_changed)

func _physics_process(delta: float) -> void:
	_update_timers(delta)
	var move_vec: Vector2 = _get_move_input()
	_handle_action_inputs(move_vec)

	if is_rolling:
		velocity.x = _roll_dir * roll_speed
		velocity.y = 0.0
	elif is_diving:
		velocity.x = move_vec.x * move_speed * 0.45
		velocity.y = dive_speed
		if is_on_floor():
			_finish_dive()
	else:
		_apply_gravity(delta)
		_handle_horizontal_movement(delta, move_vec.x)
		_handle_jump_and_drop(move_vec)
		_check_auto_ledge_grab()

	move_and_slide()
	# 眺望期间保持 back/side 定格帧，不被常规状态动画覆盖
	if not _vista_active:
		_refresh_animation()

func _get_move_input() -> Vector2:
	var kb_x: float = 0.0
	if InputMap.has_action("move_left") and InputMap.has_action("move_right"):
		kb_x = Input.get_axis("move_left", "move_right")
	var kb_y: float = 0.0
	if InputMap.has_action("move_up") and InputMap.has_action("move_down"):
		kb_y = Input.get_axis("move_up", "move_down")

	var combined := Vector2(kb_x, kb_y) + virtual_move_vector
	if combined.length() > 1.0:
		combined = combined.normalized()
	return combined

func _update_timers(delta: float) -> void:
	if is_on_floor():
		_coyote_timer = coyote_time
		can_double_jump = true
	else:
		_coyote_timer = maxf(0.0, _coyote_timer - delta)

	_jump_buffer_timer = maxf(0.0, _jump_buffer_timer - delta)
	_roll_buffer_timer = maxf(0.0, _roll_buffer_timer - delta)
	_roll_cd_timer = maxf(0.0, _roll_cd_timer - delta)
	_attack_cd_timer = maxf(0.0, _attack_cd_timer - delta)
	_parry_cd_timer = maxf(0.0, _parry_cd_timer - delta)
	_attack_lunge_timer = maxf(0.0, _attack_lunge_timer - delta)
	_hurt_anim_timer = maxf(0.0, _hurt_anim_timer - delta)
	_climb_anim_timer = maxf(0.0, _climb_anim_timer - delta)

func _handle_action_inputs(move_vec: Vector2) -> void:
	if _is_action_just_pressed("jump"):
		_jump_buffer_timer = jump_buffer_time

	if _is_action_just_pressed("roll"):
		_roll_buffer_timer = action_buffer_time

	if _is_action_just_pressed("interact"):
		interact_requested.emit()

	if _is_action_just_pressed("heal"):
		use_flask()

	if _is_action_just_pressed("skill_1"):
		trigger_skill(1)
	if _is_action_just_pressed("skill_2"):
		trigger_skill(2)

	# 翻滚可随时打断当前攻击后摇（《重生细胞》核心手感）
	if _roll_buffer_timer > 0.0 and not is_rolling and not is_diving and _roll_cd_timer <= 0.0:
		_roll_buffer_timer = 0.0
		_cancel_attack_for_roll()
		_perform_roll(move_vec.x)
		return

	# 副武器 / 格挡（公共方法内部做 cooldown 检查，供 TouchHUD 安全调用）
	if _is_action_just_pressed("secondary_action"):
		request_parry()

	# 主武器：单次点击 / 按住自动连招 / 旧 attack 动作兼容
	var wants_primary: bool = (
		_is_action_just_pressed("primary_attack")
		or _is_action_pressed("primary_attack")
		or _is_action_pressed("attack")
		or virtual_primary_held
	)
	if wants_primary and not is_attacking and not is_rolling and not is_diving and not is_parrying and _attack_cd_timer <= 0.0:
		_perform_attack(move_vec.x)

func _apply_gravity(delta: float) -> void:
	if not is_on_floor():
		var default_gravity: float = float(ProjectSettings.get_setting("physics/2d/default_gravity"))
		velocity.y += default_gravity * gravity_scale * delta
		velocity.y = minf(velocity.y, 760.0)

func _handle_horizontal_movement(delta: float, input_x: float) -> void:
	# 修复 #2：挥砍前冲期间锁定 vx，不被摩擦/输入立即覆盖
	if _attack_lunge_timer > 0.0:
		velocity.x = facing_dir * attack_lunge_speed
		return

	if absf(input_x) > 0.15:
		velocity.x = move_toward(velocity.x, input_x * move_speed, acceleration * delta)
		if not is_attacking:
			_set_facing(signf(input_x))
	else:
		velocity.x = move_toward(velocity.x, 0.0, friction * delta)

func _set_facing(dir: float) -> void:
	if dir == 0.0 or dir == facing_dir:
		return
	facing_dir = dir
	visuals.scale.x = facing_dir
	ledge_top.target_position.x = absf(ledge_top.target_position.x) * facing_dir
	ledge_bottom.target_position.x = absf(ledge_bottom.target_position.x) * facing_dir

func _handle_jump_and_drop(move_vec: Vector2) -> void:
	if _jump_buffer_timer <= 0.0:
		return

	var pressing_down: bool = move_vec.y > 0.45

	# 1. 空中下砸（Dive Attack）
	if not is_on_floor() and pressing_down:
		_jump_buffer_timer = 0.0
		_start_dive()
		return

	# 2. 单向平台下穿（Drop-through）
	# 用「临时关闭 Layer2 碰撞」实现，不依赖平台厚度，任意厚度都能穿透。
	# 仅当脚下确实是 Layer2 平台时触发；普通地板下+跳落回常规跳跃，不会原地蹲住。
	if is_on_floor() and pressing_down and not _is_dropping_through and _is_standing_on_one_way_platform():
		_jump_buffer_timer = 0.0
		_coyote_timer = 0.0
		_perform_drop_through()
		return

	# 3. 常规跳跃 / 二段跳
	if _coyote_timer > 0.0:
		velocity.y = jump_velocity
		_coyote_timer = 0.0
		_jump_buffer_timer = 0.0
	elif can_double_jump:
		velocity.y = double_jump_velocity
		can_double_jump = false
		_jump_buffer_timer = 0.0

func _is_standing_on_one_way_platform() -> bool:
	var layer_bit: int = 1 << (one_way_platform_layer - 1)
	for i: int in range(get_slide_collision_count()):
		var collision: KinematicCollision2D = get_slide_collision(i)
		# 脚下接触面法线朝上（屏幕坐标 y 向下，故 normal.y < -0.5）
		if collision.get_normal().y > -0.5:
			continue
		var collider: Object = collision.get_collider()
		if collider is CollisionObject2D and (collider.collision_layer & layer_bit) != 0:
			return true
	return false

func _perform_drop_through() -> void:
	_is_dropping_through = true
	# 临时关闭单向平台层：不会穿墙、不会穿普通地板，任意厚度平台都能顺滑穿透
	set_collision_mask_value(one_way_platform_layer, false)
	# 给一点向下初速度，确保立刻脱离平台表面进入下落
	velocity.y = maxf(velocity.y, 120.0)
	position.y += 2.0
	await get_tree().create_timer(drop_through_duration).timeout
	set_collision_mask_value(one_way_platform_layer, true)
	_is_dropping_through = false

func _check_auto_ledge_grab() -> void:
	if not is_on_floor() and velocity.y > -120.0:
		if ledge_bottom.is_colliding() and not ledge_top.is_colliding():
			global_position.y -= 18.0
			velocity.y = -180.0
			_climb_anim_timer = climb_anim_duration

func _cancel_attack_for_roll() -> void:
	_attack_token += 1
	is_attacking = false
	sword_rect.visible = false
	_attack_lunge_timer = 0.0

func _perform_roll(input_x: float) -> void:
	# 方向相关（《重生细胞》式）：按当前输入方向翻滚，无输入时才沿用当前朝向。
	# 允许攻击后摇中向后翻滚撤离，不必先松开方向键等转身。
	if absf(input_x) > 0.2:
		_roll_dir = signf(input_x)
	else:
		_roll_dir = facing_dir
	_set_facing(_roll_dir) # 翻滚即转身，视觉/判定朝向与翻滚方向一致
	is_rolling = true
	_grant_invincible("roll")
	_roll_cd_timer = roll_duration + roll_cooldown
	visuals.scale = Vector2(_roll_dir * 1.25, 0.65)
	visuals.modulate.a = 0.6

	await get_tree().create_timer(roll_duration).timeout

	visuals.scale = Vector2(_roll_dir, 1.0)
	visuals.modulate.a = 1.0
	is_rolling = false
	_release_invincible("roll")

func _perform_attack(input_x: float) -> void:
	_attack_token += 1
	var my_token: int = _attack_token
	is_attacking = true
	_attack_cd_timer = combo_interval
	_attack_lunge_timer = attack_lunge_duration

	if absf(input_x) > 0.2:
		_set_facing(signf(input_x))

	sword_rect.visible = true
	hitbox.activate(0.12)

	await get_tree().create_timer(0.16).timeout
	if my_token != _attack_token:
		return

	sword_rect.visible = false
	is_attacking = false

func _perform_parry() -> void:
	is_parrying = true
	_grant_invincible("parry")
	_parry_cd_timer = parry_duration + parry_cooldown
	shield_rect.visible = true

	await get_tree().create_timer(parry_duration).timeout

	shield_rect.visible = false
	is_parrying = false
	_release_invincible("parry")

func _start_dive() -> void:
	is_diving = true
	_grant_invincible("dive")
	visuals.scale = Vector2(facing_dir * 0.75, 1.3)

func _finish_dive() -> void:
	is_diving = false
	_release_invincible("dive")
	visuals.scale = Vector2(facing_dir, 1.0)
	dive_hitbox.activate(0.14)

func _grant_invincible(source: String) -> void:
	_invincible_sources[source] = true
	is_invincible = true

func _release_invincible(source: String) -> void:
	_invincible_sources.erase(source)
	is_invincible = not _invincible_sources.is_empty()

# ===== 供 TouchHUD 调用的公共请求接口（避免外部直改私有字段 / 绕过 cooldown）=====

func request_jump() -> void:
	_jump_buffer_timer = jump_buffer_time

func request_roll() -> void:
	_roll_buffer_timer = action_buffer_time

func request_parry() -> void:
	if is_rolling or is_diving or _parry_cd_timer > 0.0 or is_parrying:
		return
	_perform_parry()

func request_interact() -> void:
	interact_requested.emit()

func use_flask() -> void:
	if flasks <= 0 or hp >= max_hp:
		return
	flasks -= 1
	hp = minf(max_hp, hp + heal_amount)
	health_changed.emit(hp, max_hp)

## 长椅休息：回满血量与颜料瓶。供 RestBench 通过公共接口调用。
func full_restore() -> void:
	hp = max_hp
	flasks = max_flasks
	health_changed.emit(hp, max_hp)

func trigger_skill(slot: int) -> void:
	skill_triggered.emit(slot)

func take_damage(amount: float, knockback: Vector2 = Vector2.ZERO) -> void:
	if is_invincible:
		# 翻滚 / 下砸 = 全向无敌；格挡只挡身前（判定体在朝向侧）。
		# Hitbox 的 knockback.x 是击退方向：>0 表示攻击来自左侧，<0 来自右侧。
		# 攻击来自身前 ⟺ sign(knockback.x) == -facing_dir。
		# 无水平来向信息（陷阱 / 环境伤害）时默认格挡成功，保持兼容。
		if is_parrying and absf(knockback.x) > 0.01 and signf(knockback.x) != -facing_dir:
			_receive_damage(amount)
		return
	_receive_damage(amount)

func _receive_damage(amount: float) -> void:
	hp = maxf(0.0, hp - amount)
	_hurt_anim_timer = hurt_anim_duration
	health_changed.emit(hp, max_hp)
	if hp <= 0.0:
		# 零惩罚失败：状态回满，由外部场景监听 respawn_requested 送回安全点
		hp = max_hp
		flasks = max_flasks
		health_changed.emit(hp, max_hp)
		respawn_requested.emit()

func _is_action_just_pressed(action_name: String) -> bool:
	return InputMap.has_action(action_name) and Input.is_action_just_pressed(action_name)

func _is_action_pressed(action_name: String) -> bool:
	return InputMap.has_action(action_name) and Input.is_action_pressed(action_name)

# ===== 眺望演出：相机拉远 + 定格帧（WorldState 事件驱动，不锁玩家操作）=====
func _on_vista_mode_changed(active: bool, target_zoom: float, zoom_duration: float,
		_hud_fade_duration: float, vista_anim: String) -> void:
	_vista_active = active
	if camera == null:
		return
	if _vista_zoom_tween != null and _vista_zoom_tween.is_valid():
		_vista_zoom_tween.kill()  # 可打断：快速进出不叠加 tween

	var target: Vector2 = Vector2(target_zoom, target_zoom) if active else Vector2.ONE
	_vista_zoom_tween = create_tween()
	_vista_zoom_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	_vista_zoom_tween.tween_property(camera, "zoom", target, zoom_duration)

	if active:
		_play_anim(StringName(vista_anim))  # back/side 帧在此真正派上用场
	else:
		_refresh_animation()

# ===== 动画表现层：只根据已有状态选贴图，绝不反过来改手感/判定 =====
# 优先级：受击 > 攀爬(抓边) > 攻击 > 翻滚 > 下砸/腾空 > 跑 > 待机
# back/side 帧供后续 VistaZone 与剧情演出调用，不参与常规物理状态切换。
func _refresh_animation() -> void:
	if _hurt_anim_timer > 0.0:
		_play_anim(&"hurt")
	elif _climb_anim_timer > 0.0:
		_play_anim(&"climb")
	elif is_attacking:
		_play_anim(&"attack")
	elif is_rolling:
		_play_anim(&"run")  # 无独立翻滚帧：复用跑姿 + 现有 visuals 压扁/半透明表现翻滚
	elif is_diving or not is_on_floor():
		_play_anim(&"jump")
	elif absf(velocity.x) > 12.0:
		_play_anim(&"run")
	else:
		_play_anim(&"idle")

func _play_anim(anim_name: StringName) -> void:
	if _current_anim == anim_name:
		return
	if sprite == null or sprite.sprite_frames == null:
		return
	if not sprite.sprite_frames.has_animation(anim_name):
		return
	_current_anim = anim_name
	sprite.animation = anim_name
	sprite.play()
