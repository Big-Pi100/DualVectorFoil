shader_type canvas_item;
render_mode blend_mix;

// 全局纸纹叠加：静止的暖色纸纤维颗粒，模拟蜡笔绘本的纸张质感。
// 刻意不采样 screen_texture —— 多层后处理互相采样会形成反馈循环，
// 本层只输出低 alpha 的暖色噪声，靠 blend_mix 叠在已渲染画面之上。
// 放在去色层之后：黑白入侵时纸纹仍在，保持「绘本书页」隐喻。

uniform float grain_strength : hint_range(0.0, 0.5) = 0.14;
uniform float fiber_strength : hint_range(0.0, 0.5) = 0.10;
uniform vec3 paper_tint : source_color = vec3(0.96, 0.92, 0.83);

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 345.45));
	p += dot(p, p + 34.345);
	return fract(p.x * p.y);
}

void fragment() {
	// 像素级坐标（以 1280x720 基准视口为准，expanded 视口下颗粒密度一致）
	vec2 px = UV * vec2(1280.0, 720.0);

	// 细颗粒：静态白噪声（不随时间跳动，符合纸张静止质感）
	float grain = hash21(floor(px * 0.75));

	// 纸纤维：低频水平走向细纹 + 区域亮度扰动
	float fiber = sin(px.y * 0.9 + sin(px.x * 0.05) * 2.0) * 0.5 + 0.5;
	fiber *= 0.6 + 0.4 * hash21(floor(px * vec2(0.1, 0.3)));

	// 组合成极淡的暖色叠加，封顶避免洗白画面
	float a = clamp(grain_strength * grain + fiber_strength * fiber, 0.0, 0.28);
	COLOR = vec4(paper_tint, a);
}
