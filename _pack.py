import os, zipfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(os.path.dirname(HERE), 'SoulKeep_code_WO4_20261124.zip')

ROOT_DOCS = [
    'README.md', 'DOC_CONTROLS.md', 'STORY.md',
    'ACTION_CHAIN.md', 'DESIGN_A.md', 'PROJECT_MAP.md',
    'INDEX.md', 'DEV_FLOW.md', 'CANON.md', 'STYLE_LOCK.md', 'MOVESET.md',
]
SUB_DOCS = [
    ('docs/history/PACKAGE_README.md', 'PACKAGE_README.md'),
    ('docs/history/S5_REPORT.md', 'S5_REPORT.md'),
    ('docs/history/S4_REPORT.md', 'S4_REPORT.md'),
    ('docs/history/S1_S3_REPORT.md', 'S1_S3_REPORT.md'),
    ('docs/history/WO3_REPORT.md', 'WO3_REPORT.md'),
    ('docs/history/WO3_1_REPORT.md', 'WO3_1_REPORT.md'),
    ('docs/history/WO4_REPORT.md', 'WO4_REPORT.md'),
    ('docs/ref/LOOP.md', 'LOOP.md'),
    ('docs/ref/NIGHTFALL_REVIEW.md', 'NIGHTFALL_REVIEW.md'),
    ('docs/ref/AUDIT_001_DVF.md', 'AUDIT_001_DVF.md'),
    ('docs/ref/CONSULT_001_controls_hud_art.md', 'CONSULT_001_controls_hud_art.md'),
    ('docs/ref/REF_DEADCELLS.md', 'REF_DEADCELLS.md'),
]
ROOT_CODE = ['SoulKeep.html', 'build.py']
SRC = ['game.js', 'index.html', 'mobile.js', 'audio.js']
TESTS = [
    'test.js', 'test_audio.js', 'timestep_check.js', 'save_check.js',
    'ctrl_check.js', 'keymap_check.js', 'ime_check.js',
    'input_env_check.js', 'ui_check.js', 'layout_check.js', 'interact_check.js',
    'stress_input.js', 'verify_fix.js',
    'dc_feel_check.js', 'feel_table.js', 'hud_check.js', '_probe_action_chain.js',
    'probe_feel.js', 'play_probe.js', 'audit_probe.js',
]
SHOTS = ['ref_marked.png', 'cmp_final.png', 'cmp_overlay_final.png',
         'lay_desktop.png', 'lay_touch.png', 'ours_right_half.png',
         'wo4_a_desktop.png', 'wo4_b_desktop_ops.png', 'wo4_c_touch_play.png',
         'wo4_d_touch_ops.png', 'wo4_e_touch_edit.png', 'wo4_f_touch_edit_dragged.png',
         'wo3_a0_hud_before.png', 'wo3_a1_hud.png', 'wo3_a2_menu_souls.png',
         'wo3_a3_menu_ops.png', 'wo3_b1_960_ops.png', 'wo3_c1_touch_hud.png',
         'wo3_c2_touch_ops.png', 'wo3_d2_short_ops_bottom.png',
         'wo31_a_solid_no_flash.png', 'wo31_b_plank_flash.png',
         'flat_02_slit.png', 'flat_03_inside.png']

items = []
for f in ROOT_DOCS:
    p = os.path.join(HERE, f)
    if os.path.exists(p): items.append((p, f))
for rel, arc in SUB_DOCS:
    p = os.path.join(HERE, rel)
    if os.path.exists(p): items.append((p, arc))
for f in ROOT_CODE:
    p = os.path.join(HERE, f)
    if os.path.exists(p): items.append((p, f))
for f in SRC:
    p = os.path.join(HERE, 'src', f)
    if os.path.exists(p): items.append((p, 'src/' + f))
for f in TESTS:
    p = os.path.join(HERE, f)
    if os.path.exists(p): items.append((p, f))
for f in SHOTS:
    p = os.path.join(HERE, 'shots', f)
    if os.path.exists(p): items.append((p, 'shots/' + f))

missing = [a for _, a in items if False]
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p, arc in items:
        z.write(p, arc)

size = os.path.getsize(OUT)
print('→ %s' % OUT)
print('  %d 个文件, %.1f MB' % (len(items), size / 1024 / 1024))
for p, arc in items:
    print('    %-42s %6.0fKB' % (arc, os.path.getsize(p) / 1024))
