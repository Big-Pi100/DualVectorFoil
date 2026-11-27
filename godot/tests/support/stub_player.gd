extends CharacterBody2D

## 测试用桩玩家：只实现敌人需要的两个契约（位置 + take_damage）。
## 不用真 Player：真 Player 会自己跑输入、播动画、发 respawn 信号，
## 测敌人 AI 时那些全是噪声，而且一改玩家参数这里就跟着红。

var hp: float = 120.0
var hits: int = 0

func take_damage(amount: float, _knockback: Vector2 = Vector2.ZERO) -> void:
	hp -= amount
	hits += 1
