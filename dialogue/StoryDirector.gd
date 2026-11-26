extends CanvasLayer

## 《二向箔》剧情总线（GDD 3.2 / 路线图第二阶段第 4 项）。
## 复用 Dialogue Manager v3.10.5（MIT，addons/dialogue_manager）的运行时编译器与行遍历；
## 剧本走 .dialogue 纯文本 + create_resource_from_text 运行时编译，
## 绕开未启用编辑器插件时不会导入为 Resource 的限制。
## 信号解耦：只发 line_shown/choices_shown/dialogue_finished，不直接引用任何对话框/房间节点。
## 不写 class_name（Autoload 同名冲突），运行时查找 Autoload 避免编译期 ID not found。

signal line_shown(character: String, text: String, tags: PackedStringArray)
signal choices_shown(choices: Array)
signal dialogue_finished(dialogue_id: String)

const DIALOGUE_DIR: String = "res://dialogue/"

@export var auto_pause_world: bool = true        # 对话期间暂停世界，结束/跳过后恢复
@export var prologue_dialogue_id: String = "prologue"
@export var prologue_seen_flag: String = "prologue_seen"

var _dm: Node = null
var _ws: Node = null
var _resource = null            # DialogueResource（Variant：跨插件脚本类型，避免编译期耦合）
var _current_line = null        # DialogueLine
var _current_id: String = ""
var _choices: Array = []
var _active: bool = false
var _advancing: bool = false     # 防重入：await 期间重复 next/choose

func _ready() -> void:
	layer = 95
	process_mode = Node.PROCESS_MODE_ALWAYS
	_dm = get_tree().root.get_node_or_null("DialogueManager")
	_ws = get_tree().root.get_node_or_null("WorldState")

func is_active() -> bool:
	return _active

func current_dialogue_id() -> String:
	return _current_id

func has_choices() -> bool:
	return _active and not _choices.is_empty()

func prologue_seen() -> bool:
	if _ws == null:
		return false
	return bool(_ws.story_flags.get(prologue_seen_flag, false))

## 开始一段对话。对话 ID 对应 dialogue/<id>.dialogue 文本文件。
func start(dialogue_id: String, title: String = "start") -> void:
	if _active or _dm == null:
		return
	var path: String = DIALOGUE_DIR + dialogue_id + ".dialogue"
	if not FileAccess.file_exists(path):
		push_warning("StoryDirector: 剧本不存在 %s" % path)
		return
	var file: FileAccess = FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var script_text: String = file.get_as_text()
	file.close()

	_resource = _dm.call("create_resource_from_text", script_text)
	if _resource == null:
		push_warning("StoryDirector: 剧本编译失败 %s" % dialogue_id)
		return

	_current_id = dialogue_id
	_active = true
	_choices.clear()
	if auto_pause_world:
		get_tree().paused = true
	await _advance(title)

func _advance(key: String) -> void:
	if not _active or _dm == null or _resource == null:
		return
	_advancing = true
	_current_line = await _dm.call("get_next_dialogue_line", _resource, key)
	_advancing = false
	if not _active:
		return
	if _current_line == null:
		_finish()
		return

	var character: String = str(_current_line.get("character"))
	var text: String = str(_current_line.get("text"))
	var tags: PackedStringArray = _current_line.get("tags")
	line_shown.emit(character, text, tags)

	_choices.clear()
	var responses: Array = _current_line.get("responses")
	for response: Variant in responses:
		# DialogueResponse 是 RefCounted，Object.get() 只收 1 参数；直接走属性访问
		var response_obj: Object = response as Object
		if response_obj != null and bool(response_obj.get("is_allowed")):
			_choices.append(response)
	if not _choices.is_empty():
		choices_shown.emit(_choices)

## 无选项时推进到下一行；有选项时必须走 choose()。
func next() -> void:
	if not _active or _advancing or _current_line == null or not _choices.is_empty():
		return
	var next_id: String = str(_current_line.get("next_id"))
	if next_id.is_empty():
		_finish()
		return
	_advance(next_id)

## 选择第 index 个选项（越界忽略，零挫败）。
func choose(index: int) -> void:
	if not _active or _advancing or _choices.is_empty():
		return
	if index < 0 or index >= _choices.size():
		return
	var response: Object = _choices[index] as Object
	var next_id: String = str(response.get("next_id"))
	_choices.clear()
	if next_id.is_empty():
		_finish()
		return
	_advance(next_id)

## 跳过整段对话（零挫败：任何时刻可退出，不惩罚、不阻塞剧情）。
func skip() -> void:
	if not _active:
		return
	_finish()

func _finish() -> void:
	if not _active:
		return
	var finished_id: String = _current_id
	_active = false
	_advancing = false
	_choices.clear()
	_current_line = null
	_resource = null
	if auto_pause_world:
		get_tree().paused = false
	# 开篇剧情播完写 story_flag（存档由 WorldState 统一持有）
	if finished_id == prologue_dialogue_id and _ws != null:
		_ws.story_flags[prologue_seen_flag] = true
	dialogue_finished.emit(finished_id)
