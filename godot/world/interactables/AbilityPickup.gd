class_name AbilityPickup
extends Area2D

## 能力拾取点：把 `WorldState.unlocked_abilities` 里的一条永久点亮。
##
## 为什么是"按 U 拾取"而不是"碰到自动拿"：
##   自动拿会让玩家在跳跃穿行时一闪而过地获得能力，画面上只多了一行没人读的提示，
##   然后走两步发现"刚才那个东西是干嘛的"。拾取要有一个停顿。
##   契约复用了 RestBench 那一条：只认「有 interact_requested 信号的 body」，
##   不硬编码 Player 类型（AGENTS.md：跨模块一律 Signal）。
##
## 位置由蓝图 `A` 字符决定，`ability=` 给出能力 id —— 与地形同一份文本真源，
## 手工摆节点会在下次生成时被冲掉。

signal picked_up(ability_id: String)

@export var ability_id: String = "fold"
@export var display_name: String = "折叠"

@onready var prompt_label: Label = $PromptLabel
@onready var visual: Node2D = $Visual

var _player_in_range: Node2D = null
var _taken: bool = false
var _bob_time: float = 0.0

func _ready() -> void:
	prompt_label.visible = false
	# 读档回来：能力已经在了，这里就不该再立一张纸片等着被捡第二次。
	if WorldState.has_ability(ability_id):
		_consume(false)
		return
	body_entered.connect(_on_body_entered)
	body_exited.connect(_on_body_exited)

func _process(delta: float) -> void:
	if _taken:
		return
	# 轻浮动 + 轻摇摆：让它在静态地形里一眼看得出"这东西会动"。
	# 静止的纸片和背景装饰物没有区别，玩家会直接走过去。
	_bob_time += delta
	visual.position.y = sin(_bob_time * 2.2) * 5.0
	visual.rotation = sin(_bob_time * 1.4) * 0.06

func _on_body_entered(body: Node2D) -> void:
	if _taken or not body.has_signal("interact_requested"):
		return
	_player_in_range = body
	if not body.interact_requested.is_connected(_on_interact):
		body.interact_requested.connect(_on_interact)
	prompt_label.text = "[U] 拾取 · %s" % display_name
	prompt_label.visible = true

func _on_body_exited(body: Node2D) -> void:
	if body != _player_in_range:
		return
	if body.interact_requested.is_connected(_on_interact):
		body.interact_requested.disconnect(_on_interact)
	_player_in_range = null
	if not _taken:
		prompt_label.visible = false

func _on_interact() -> void:
	if _taken:
		return
	_consume(true)

## announce=false 用于"读档时已经拥有"：静默消失，不弹提示。
func _consume(announce: bool) -> void:
	_taken = true
	if announce:
		WorldState.unlock_ability(ability_id)
		picked_up.emit(ability_id)
	# 拾取后立刻不可再交互：碰撞与提示一起撤掉，
	# 否则玩家在 2 秒淡出期间还能再按一次 U，又广播一遍。
	set_deferred("monitoring", false)
	# 纸片本体**当场消失**。留它在那儿 2.4 秒会被读成「没捡到」——
	# 实拍 shot_fold_taken.png 第一版就是这样：提示写着"获得"，
	# 红色折纸还杵在原地，两句话互相打脸。
	visual.visible = false
	prompt_label.visible = false
	if announce:
		_show_gain_text()
	else:
		visible = false

func _show_gain_text() -> void:
	# 拾取确认要停留够久。1.2s 太短 —— 玩家此刻正在看角色，不会看屏幕角落。
	prompt_label.text = "获得「%s」 · 空中再按一次跳跃" % display_name
	prompt_label.visible = true
	await get_tree().create_timer(2.4).timeout
	if not is_inside_tree():
		return
	prompt_label.visible = false
	visible = false
