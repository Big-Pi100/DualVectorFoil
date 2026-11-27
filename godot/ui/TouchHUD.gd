class_name TouchHUD
extends CanvasLayer

## 《二向箔》自适应触屏 HUD —— 复刻《重生细胞》移动版操作布局。
## 左侧半屏浮动摇杆 + 右侧 6 动作键 + 快捷颜料瓶 + 上下文动态互动键。
## 所有按键通过 Player 的公共请求接口转发，不直改私有字段、不绕过 cooldown。

@export var joystick_max_radius: float = 64.0
@export var joystick_deadzone: float = 12.0
# 摇杆左半屏判定延伸到 x=704（0.55×1280），与右侧按钮组起点对齐，消除 640~704 死区
@export var joystick_half_screen_ratio: float = 0.55
## 真机调优：按下反馈色（拇指需即时确认；松手恢复白色）
@export var press_feedback_modulate: Color = Color(0.72, 0.72, 0.72, 1.0)

@onready var root_control: Control = $RootControl
@onready var right_group: Control = $RootControl/RightButtonsGroup
@onready var left_area: Control = $RootControl/LeftJoystickArea
@onready var joy_base: Control = $RootControl/LeftJoystickArea/JoystickBase
@onready var joy_knob: Control = $RootControl/LeftJoystickArea/JoystickKnob

@onready var btn_attack: Button = $RootControl/RightButtonsGroup/BtnPrimaryAttack
@onready var btn_secondary: Button = $RootControl/RightButtonsGroup/BtnSecondary
@onready var btn_jump: Button = $RootControl/RightButtonsGroup/BtnJump
@onready var btn_roll: Button = $RootControl/RightButtonsGroup/BtnRoll
@onready var btn_skill_1: Button = $RootControl/RightButtonsGroup/BtnSkill1
@onready var btn_skill_2: Button = $RootControl/RightButtonsGroup/BtnSkill2
@onready var btn_heal: Button = $RootControl/BtnHeal
@onready var btn_interact: Button = $RootControl/BtnInteract
# 不标 HealthBar 类型：`--script` 模式下 class_name 全局类晚于脚本解析注册，
# 标了会在测试里直接 Parse Error，整个 HUD 脚本失效、触屏和血条一起坏掉。
@onready var health_bar: Control = $RootControl/HealthBar

var player: Player = null
var _joystick_touch_index: int = -1
var _joystick_origin: Vector2 = Vector2.ZERO
var _vista_tween: Tween = null

func _ready() -> void:
	joy_base.visible = false
	joy_knob.visible = false
	btn_interact.visible = false
	# 没有触屏就隐藏虚拟按键。六颗按钮占掉右半屏 40%，
	# 把房间的台阶和门全挡在后面（2026-11-27 实拍 shot_Room01.png 一眼就能看出来）——
	# 键鼠玩家看房间，不该隔着一层用不上的按钮。
	if not DisplayServer.is_touchscreen_available():
		right_group.visible = false
		btn_heal.visible = false
	if get_node_or_null("/root/WorldState") != null:
		WorldState.vista_mode_changed.connect(_on_vista_mode_changed)

	# 主武器：按下开始连招，松开停止（长按自动连击）
	btn_attack.button_down.connect(func() -> void:
		if player:
			player.virtual_primary_held = true
	)
	btn_attack.button_up.connect(func() -> void:
		if player:
			player.virtual_primary_held = false
	)

	# 修复 #3：改走公共请求接口，格挡 cooldown 由 Player 内部判定
	btn_secondary.pressed.connect(func() -> void:
		if player:
			player.request_parry()
	)
	btn_jump.pressed.connect(func() -> void:
		if player:
			player.request_jump()
	)
	btn_roll.pressed.connect(func() -> void:
		if player:
			player.request_roll()
	)
	btn_skill_1.pressed.connect(func() -> void:
		if player:
			player.trigger_skill(1)
	)
	btn_skill_2.pressed.connect(func() -> void:
		if player:
			player.trigger_skill(2)
	)
	btn_heal.pressed.connect(func() -> void:
		if player:
			player.use_flask()
	)
	btn_interact.pressed.connect(func() -> void:
		if player:
			player.request_interact()
	)

	# 真机调优：所有动作键统一按下变暗反馈，松手恢复（按钮尺寸已在场景 ≥96×96）
	for button: Button in [btn_attack, btn_secondary, btn_jump, btn_roll,
			btn_skill_1, btn_skill_2, btn_heal, btn_interact]:
		_connect_press_feedback(button)

func _connect_press_feedback(button: Button) -> void:
	button.button_down.connect(func() -> void: button.modulate = press_feedback_modulate)
	button.button_up.connect(func() -> void: button.modulate = Color.WHITE)

func bind_player(target_player: Player) -> void:
	player = target_player
	# 血条跟着同一条绑定走：房间只需要认「HUD 绑上玩家」这一个动作，
	# 不必知道 HUD 内部还有哪些显示件。
	if health_bar != null and health_bar.has_method("bind_player"):
		health_bar.call("bind_player", target_player)

func set_interact_prompt(visible_prompt: bool, label_text: String = "交互") -> void:
	btn_interact.visible = visible_prompt
	btn_interact.text = label_text

func _input(event: InputEvent) -> void:
	if not player:
		return

	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event
		if touch.pressed and _joystick_touch_index == -1:
			# 左半屏按下才生成浮动摇杆（右半屏留给动作键，避免误触）
			var half_width: float = get_viewport().get_visible_rect().size.x * joystick_half_screen_ratio
			if touch.position.x <= half_width:
				_joystick_touch_index = touch.index
				_joystick_origin = touch.position
				joy_base.global_position = _joystick_origin - joy_base.size * 0.5
				joy_knob.global_position = _joystick_origin - joy_knob.size * 0.5
				joy_base.visible = true
				joy_knob.visible = true
				player.virtual_move_vector = Vector2.ZERO
		elif not touch.pressed and touch.index == _joystick_touch_index:
			_reset_joystick()

	elif event is InputEventScreenDrag:
		var drag: InputEventScreenDrag = event
		if drag.index == _joystick_touch_index:
			var delta_vec: Vector2 = drag.position - _joystick_origin
			var clamped: Vector2 = delta_vec.limit_length(joystick_max_radius)
			joy_knob.global_position = (_joystick_origin + clamped) - joy_knob.size * 0.5
			if delta_vec.length() < joystick_deadzone:
				player.virtual_move_vector = Vector2.ZERO
			else:
				# 归一化到 [-1, 1]；y 向下为正，正好对应「下推」
				player.virtual_move_vector = clamped / joystick_max_radius

func _reset_joystick() -> void:
	_joystick_touch_index = -1
	joy_base.visible = false
	joy_knob.visible = false
	if player:
		player.virtual_move_vector = Vector2.ZERO

# ===== 眺望演出：HUD 淡出让位绘本全景（WorldState 事件驱动）=====
func _on_vista_mode_changed(active: bool, _target_zoom: float, _zoom_duration: float,
		hud_fade_duration: float, _vista_anim: String) -> void:
	if root_control == null:
		return
	if _vista_tween != null and _vista_tween.is_valid():
		_vista_tween.kill()  # 可打断：快速进出不叠加 tween

	_vista_tween = create_tween()
	if active:
		_vista_tween.tween_property(root_control, "modulate:a", 0.0, hud_fade_duration)
		# 淡出后隐藏整块 Control，避免透明按钮仍吞掉触摸事件
		_vista_tween.tween_callback(func() -> void: root_control.visible = false)
	else:
		root_control.visible = true
		_vista_tween.tween_property(root_control, "modulate:a", 1.0, hud_fade_duration)

func _exit_tree() -> void:
	if _vista_tween != null and _vista_tween.is_valid():
		_vista_tween.kill()
	if get_node_or_null("/root/WorldState") != null:
		if WorldState.vista_mode_changed.is_connected(_on_vista_mode_changed):
			WorldState.vista_mode_changed.disconnect(_on_vista_mode_changed)
