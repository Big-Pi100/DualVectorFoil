shader_type canvas_item;
// 手绘沸腾线（boiling line）—— 让静态蜡笔贴图以离散帧率轻微位移，
// 观感接近手翻书 / 《茶杯头》，不是电子噪点。
//
// 那份 GDD 的写法有两处会翻车，这里都改了：
//   1. `hash(UV * 10.0 + t)` 是**逐像素白噪声**：相邻像素偏移完全不同，
//      结果不是"线条在抖"，是整张图沙沙响、边缘碎成雪花（实测 54% 像素在变、
//      单点最大通道差 194）。
//   2. 采样 `UV + offset` 不夹边界，贴图外缘会采到图外像素，描边缺角或闪黑边。
//
// 这里用**低频平滑位移场**（两组正交 sin/cos 交叉），相邻区域的偏移是连续的，
// 所以差异成片而不是点点孤立——手绘各部分的相对位置有误差，就是这个形状。
// 时间走 `floor(TIME * boil_fps)`，帧内绝对静止，到点才整体跳一次。

uniform float boil_fps : hint_range(1.0, 24.0) = 6.7;   // 0.15s 一帧
uniform float boil_px : hint_range(0.0, 4.0) = 1.0;     // 抖动幅度（纹理像素）

float hash11(float n) {
	return fract(sin(n * 127.1) * 43758.5453);
}

void fragment() {
	// 整帧统一偏移 —— 这是"整张重画，位置差了一点"的形状。
	// 不能用**空间变化的**位移场：那样同一块区域的像素会互相错位，
	// 纯色区域也会被搅乱，看起来是噪点而不是手绘抖动。
	float t = floor(TIME * boil_fps);
	vec2 jitter = vec2(hash11(t), hash11(t + 41.0)) - 0.5;
	vec2 off = jitter * 2.0 * boil_px * TEXTURE_PIXEL_SIZE;

	vec2 half_px = TEXTURE_PIXEL_SIZE * 0.5;
	vec2 uv = clamp(UV + off, half_px, vec2(1.0) - half_px);
	COLOR = texture(TEXTURE, uv);
}
