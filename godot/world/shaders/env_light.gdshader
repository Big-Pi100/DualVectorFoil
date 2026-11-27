shader_type canvas_item;
render_mode unshaded;

// 环境光（紫月）—— 一个开关切换整个世界的光照，而不是给每件资产出两套图。
//
// 为什么不是"乘性光照"：暖黄的地面在紫光下乘出来是**暗棕**，不是紫。
// 光只能衰减材质自身的通道，暖色材质里没有蓝，乘什么都不会变蓝。
// 所以这里做的是**着色**：把色相拉向月光的色相，再重定饱和与明度。
// 这叫风格化，但它和其它材质用的是同一束光 —— 这正是需求要的"环境反馈"。
//
// 三条不能省的：
//   1. 明度用**加法**不用乘法。乘法压对比度（实测 87% → 54%，就是"褪色"）。
//   2. 色相拉向目标后要**压饱和**，否则背景比演员艳。
//   3. 植被（黄绿—绿，47°~162°）保住一部分原色相，否则草地变紫，读不出"草"。
//      真实月夜里植物也是暗绿，不是紫 —— 这条不是妥协，是对的。

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;

// ── 0 = 解放态（原始暖色） 1 = 暗黑态（紫月） ──
uniform float night : hint_range(0.0, 1.0) = 0.0;

// ── 月光 ──
uniform vec3 moon_tint : source_color = vec3(0.42, 0.38, 0.78);
uniform float tint_pull : hint_range(0.0, 1.0) = 0.90;   // 色相拉向月光的比例（剩下的是原色相）
uniform float veg_protect : hint_range(0.0, 1.0) = 0.55; // 植被额外保留原色相的比例
uniform float sat_scale : hint_range(0.0, 1.5) = 0.42;
uniform float sat_add : hint_range(-0.5, 0.5) = 0.04;
uniform float val_mul : hint_range(0.0, 1.5) = 0.90;
uniform float val_add : hint_range(-0.5, 0.5) = -0.10;
uniform float contrast_boost : hint_range(0.5, 2.0) = 1.30;
uniform float lift : hint_range(-0.5, 0.5) = 0.0;        // 整体提/压暗，加法

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void fragment() {
	vec4 src = texture(screen_tex, SCREEN_UV);

	// 亮度极低的像素（线稿、阴影缝隙）不参与色相重定，否则会析出彩边
	if (src.a < 0.001) {
		COLOR = src;
	} else {
		vec3 hsv = rgb2hsv(src.rgb);
		float h = hsv.x;
		float s = hsv.y;
		float v = hsv.z;

		float tgt = rgb2hsv(moon_tint).x;

		// 色相要走哪个方向 —— 这里有个坑，别改回单一路径：
		// 从黄(60°)到紫(246°)的最短路径是「负向」，会经过红。
		// 土这样走没问题（一路到紫），但植被被 veg_protect 减半推拉后，
		// 正好停在红/品红区间 —— 草会变粉。实测过，不是理论担忧。
		// 所以植被强制走「正向」：黄→绿→青→蓝，一路都是自然色。
		float d_up = fract(tgt - h);            // 正向 0..1
		float d_dn = d_up - 1.0;                // 负向 -1..0
		float d_short = (d_up <= 0.5) ? d_up : d_dn;
		// 正向超过 0.6 圈说明绕远了（比如白天要暖光时），退回最短路径
		float d_veg = (d_up <= 0.60) ? d_up : d_dn;

		// 植被保护：黄绿~绿 且有一定饱和度时，减弱着色
		float veg = smoothstep(0.13, 0.19, h) * (1.0 - smoothstep(0.39, 0.45, h))
		          * smoothstep(0.15, 0.30, s);
		// 方向选择用陡一点的权重，线性混合会把方向也平均掉（=停在红）
		float w = smoothstep(0.25, 0.55, veg);
		float d = mix(d_short, d_veg, w);
		float pull = tint_pull * (1.0 - veg * veg_protect);

		float h2 = fract(h + d * pull);
		float s2 = clamp(s * sat_scale + sat_add, 0.0, 1.0);
		// 植被把丢掉的那部分饱和度补回来一点，保住"草是绿的"
		s2 = clamp(s2 + veg * veg_protect * (s * 0.75 - s2), 0.0, 1.0);
		float v2 = clamp(v * val_mul + val_add, 0.0, 1.0);

		vec3 out_c = hsv2rgb(vec3(h2, s2, v2));

		// 对比度补偿（降饱和会削平亮度差），只动亮度不动色相
		float L = dot(out_c, vec3(0.299, 0.587, 0.114));
		float L2 = clamp((L - 0.5) * contrast_boost + 0.5, 0.0, 1.0);
		out_c = clamp(out_c + (L2 - L), 0.0, 1.0);

		out_c = clamp(out_c + lift, 0.0, 1.0);

		// night 作为总混合权重：0 时一个像素都不动
		COLOR = vec4(mix(src.rgb, out_c, night), src.a);
	}
}
