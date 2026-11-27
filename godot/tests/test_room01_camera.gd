extends SceneTree

## Room01 相机边界：**房间变宽之后，玩家还能不能一直看得见自己**。
##
## 为什么单独一个文件：Room01 从 40 列收窄到 34 列（1632px），
## 而 `BaseRoom.room_bounds` 的默认值还是 `1280×720`（一屏时代写死的）。
## 第五次改关卡尺度之后这条更不能省：房间从 1632 宽变成 4800 宽，一屏只是零头。
## 这个错不会让任何逻辑测试变红 —— 玩家照样能走、门照样能开、敌人照样会死，
## 只是**走到右半边之后，人从屏幕右边走了出去**。
##
##   C1 站在出生点：人必须在画面内
##   C2 站在闸门右侧地面（x≈1300）：人必须在画面内
##   C3 站在最右端（x≈1600，右门内侧）：人必须在画面内
##   C4 相机可用范围必须覆盖整间房（左右各到墙）
##
## 判据用**屏幕坐标**，不用 `cam.limit_*` 的值 —— 后者是"配置对不对"，
## 前者是"玩家眼睛看到什么"，才是要证的东西。

const ROOM_PATH: String = "res://world/rooms/Room01.tscn"

var _fail: int = 0
var _root: Node = null
var _room: Node = null
var _player: Node2D = null

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	_root = Node.new()
	root.add_child(_root)
	var ps: PackedScene = load(ROOM_PATH) as PackedScene
	if ps == null:
		push_error("加载失败：%s" % ROOM_PATH)
		quit(2)
		return
	_room = ps.instantiate()
	_root.add_child(_room)
	await _frames(6)
	_player = _room.get_node_or_null("Player") as Node2D
	if _player == null:
		push_error("Room01 里没有 Player")
		quit(2)
		return

	await _run_cases()
	_root.queue_free()
	print("ROOM01 CAMERA: %s" % ("PASS" if _fail == 0 else "FAIL"))
	print("errors: %d" % _fail)
	quit(1 if _fail > 0 else 0)

func _check(ok: bool, msg: String) -> void:
	print(("  ok   " if ok else "  FAIL ") + msg)
	if not ok:
		_fail += 1

func _frames(n: int) -> void:
	for i: int in range(n):
		await physics_frame

## 把人挪到某处、等相机收敛，返回人的屏幕坐标。
## 相机 smoothing 要跑一会儿才到位，8 帧不够（实测还是旧位置）。
func _screen_at(x: float) -> Vector2:
	# y 必须在空腔里。上一版写 520 是因为房间只有 15 行、520 是半空；
	# 这一版天花板在 864，520 是实心岩层，人会被挤出去，读到的屏幕坐标是假的。
	_player.global_position = Vector2(x, 1700.0)
	_player.velocity = Vector2.ZERO
	# 必须重置平滑：关卡有 4800 宽，沿 x 传送几百上千像素之后，
	# smoothing 要跑很久才收敛，40 帧不够 —— 读到的是相机"还在路上"的位置。
	var cam: Camera2D = _player.get_node_or_null("Camera2D") as Camera2D
	if cam != null:
		cam.reset_smoothing()
	await _frames(40)
	var ct: Transform2D = _player.get_global_transform_with_canvas()
	return ct.origin

func _run_cases() -> void:
	var vp: Vector2 = Vector2(1280.0, 720.0)

	# C1 出生点
	var p1: Vector2 = await _screen_at(120.0)
	_check(p1.x > 0.0 and p1.x < vp.x, "C1 出生点 屏幕 x=%.0f 在 [0,1280]" % p1.x)

	# C2 闸门右侧（过了门之后）
	var p2: Vector2 = await _screen_at(3400.0)
	_check(p2.x > 0.0 and p2.x < vp.x,
		"C2 闸门右侧 x=3400 屏幕 x=%.0f 在 [0,1280]" % p2.x)

	# C3 最右端（右门内侧）
	var p3: Vector2 = await _screen_at(4600.0)
	_check(p3.x > 0.0 and p3.x < vp.x,
		"C3 最右端 x=4600 屏幕 x=%.0f 在 [0,1280]" % p3.x)

	# C4 相机可覆盖整间房：左墙 16、右墙 1648。
	# 断言的是**视野边界**（limit）而不是相机中心能走多远 ——
	# 中心范围本来就该被夹在 [192, 1456] 里，那是"镜头不出墙"的正常结果。
	var cam: Camera2D = _player.get_node_or_null("Camera2D") as Camera2D
	if cam == null:
		_check(false, "C4 Player 下没有 Camera2D")
		return
	_check(float(cam.limit_left) <= 20.0 and float(cam.limit_right) >= 4810.0,
		"C4 视野边界 [%d,%d] 应覆盖房间 [16,4816]" % [cam.limit_left, cam.limit_right])
