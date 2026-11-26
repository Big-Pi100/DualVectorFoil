shader_type canvas_item;

uniform float boil_speed : hint_range(1.0, 20.0) = 6.5;
uniform float boil_strength : hint_range(0.0, 0.02) = 0.004;

// 简易伪随机哈希
float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void fragment() {
	// 按离散时间步进跳动，模拟手翻动画书的帧率感
	float discrete_time = floor(TIME * boil_speed);
	vec2 offset = vec2(
		hash(UV * 10.0 + discrete_time) - 0.5,
		hash(UV * 10.0 + discrete_time + 42.0) - 0.5
	) * boil_strength;

	COLOR = texture(TEXTURE, UV + offset);
}
