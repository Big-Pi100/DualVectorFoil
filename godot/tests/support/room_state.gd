extends RefCounted

## 测试用的房间状态准备。
##
## 2026-11-27 起 `Room01` 声明了 `invade_on_enter = true`（`docs/gdd/12` F0）：
## 一进门就被占。这是**关卡的正常行为**，但组件级测试（光照 / 贴图 / 净化链）
## 需要自己控制侵占状态，不能依赖房间的默认值。
##
## 这些用例里出现过的两种静默失效，都在这里挡住：
##   1. 直接 `ws.invaded_rooms.append("room_01")` —— 房间已经自动占过一次，
##      append 后数组里有两个 "room_01"，`purify_room` 的 `erase()` 只删一个，
##      于是「清完应净化」永远 FAIL。**先 force_uninvaded 再 append 就不会重复。**
##   2. 只 `clear()` 不清 `purified_rooms` —— 下次进房 `_ensure_scripted_invasion`
##      会再占回来。所以顺手记入已清，把自动占房挡在门外。

static func force_uninvaded(ws: Node, room: Node2D, room_id: String = "room_01") -> void:
	ws.invaded_rooms.clear()
	if not ws.purified_rooms.has(room_id):
		ws.purified_rooms.append(room_id)
	# 重算一次：清掉已生成的敌人、night 归 0、容器隐藏
	room.call("_setup_invasion_state")
