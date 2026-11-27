shader_type canvas_item;

uniform sampler2D screen_texture : hint_screen_texture, filter_linear_mipmap;
uniform float desaturate_amount : hint_range(0.0, 1.0) = 0.0; // 0=全彩, 1=纯黑白去色
uniform vec2 wipe_center = vec2(0.5, 0.5);
uniform float wipe_radius : hint_range(0.0, 2.0) = 0.0;

void fragment() {
	vec4 tex_color = texture(screen_texture, SCREEN_UV);
	float gray = dot(tex_color.rgb, vec3(0.299, 0.587, 0.114));
	vec3 mono_color = vec3(gray * 1.05); // 略带纸张亮度的素描灰

	// 净化扩散：半径内恢复彩色，半径外保持灰白
	float dist = distance(SCREEN_UV, wipe_center);
	float mask = smoothstep(wipe_radius - 0.05, wipe_radius + 0.05, dist);
	float final_desat = desaturate_amount * mask;

	COLOR = vec4(mix(tex_color.rgb, mono_color, final_desat), tex_color.a);
}
