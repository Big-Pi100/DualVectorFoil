extends CanvasLayer

## 《二向箔》蜡笔绘本对话框（GDD 3.2 / 路线图第二阶段第 4 项）。
## 订阅 StoryDirector 信号渲染说话人/正文/选项/跳过；不直改剧情状态、不硬编码房间路径。
## 移动端友好：整块面板可点推进，选项大按钮，随时「跳过」（零挫败）。

@onready var root_control: Control = $RootControl
@onready var speaker_label: Label = $RootControl/Panel/VBox/Speaker
@onready var text_label: RichTextLabel = $RootControl/Panel/VBox/Text
@onready var choices_box: VBoxContainer = $RootControl/Panel/VBox/Choices
@onready var tap_hint: Label = $RootControl/Panel/VBox/TapHint
@onready var skip_button: Button = $RootControl/SkipButton

var _director: Node = null

func _ready() -> void:
	layer = 96
	process_mode = Node.PROCESS_MODE_ALWAYS
	root_control.visible = false
	_director = get_tree().root.get_node_or_null("StoryDirector")
	if _director != null:
		_director.line_shown.connect(_on_line_shown)
		_director.choices_shown.connect(_on_choices_shown)
		_director.dialogue_finished.connect(_on_dialogue_finished)
	skip_button.pressed.connect(_on_skip_pressed)

func _on_line_shown(character: String, text: String, _tags: PackedStringArray) -> void:
	root_control.visible = true
	speaker_label.text = (character if character != "" else "旁白")
	text_label.text = text
	# 有剧情正文才显示推进提示；选项由 choices_box 单独接管
	tap_hint.visible = true

func _on_choices_shown(choices: Array) -> void:
	tap_hint.visible = false
	_clear_choices()
	for i: int in range(choices.size()):
		var response: Variant = choices[i]
		var button := Button.new()
		button.name = "Choice%d" % i
		button.text = "· " + str(response.get("text"))
		button.custom_minimum_size = Vector2(720, 62)
		button.add_theme_font_size_override("font_size", 24)
		button.pressed.connect(_on_choice_pressed.bind(i))
		choices_box.add_child(button)

func _on_choice_pressed(index: int) -> void:
	if _director != null:
		_director.call("choose", index)

func _on_dialogue_finished(_dialogue_id: String) -> void:
	_clear_choices()
	root_control.visible = false

func _on_skip_pressed() -> void:
	if _director != null:
		_director.call("skip")

func _unhandled_input(event: InputEvent) -> void:
	if not root_control.visible:
		return
	if _director == null or bool(_director.call("has_choices")):
		return
	# 触屏点面板任意处 / 键盘互动键推进
	if event is InputEventScreenTouch:
		var touch: InputEventScreenTouch = event
		if touch.pressed:
			_director.call("next")
			get_viewport().set_input_as_handled()
	elif event is InputEventKey:
		var key: InputEventKey = event
		if key.pressed and key.physical_keycode == 85:  # U 互动键
			_director.call("next")
			get_viewport().set_input_as_handled()

func _clear_choices() -> void:
	for child: Node in choices_box.get_children():
		choices_box.remove_child(child)
		child.queue_free()

func _exit_tree() -> void:
	if _director != null:
		if _director.line_shown.is_connected(_on_line_shown):
			_director.line_shown.disconnect(_on_line_shown)
		if _director.choices_shown.is_connected(_on_choices_shown):
			_director.choices_shown.disconnect(_on_choices_shown)
		if _director.dialogue_finished.is_connected(_on_dialogue_finished):
			_director.dialogue_finished.disconnect(_on_dialogue_finished)
