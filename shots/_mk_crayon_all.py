
import sys
from PIL import Image, ImageDraw, ImageFont
import os
order = ["stand","walk","jump","fall","attack","cast","hurt","crouch","slide","dash"]
d = r"E:/IdentityCard/game-soulkeep/shots"
imgs = [Image.open(os.path.join(d, "crayon_%s.png" % s)) for s in order]
w, h = imgs[0].size
pad, top = 6, 34
W = (w + pad) * len(imgs) + pad
out = Image.new("RGB", (W, h + top + pad), (24, 22, 32))
dr = ImageDraw.Draw(out)
try:
    f = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except Exception:
    f = ImageFont.load_default()
for i, (s, im) in enumerate(zip(order, imgs)):
    x = pad + i * (w + pad)
    out.paste(im, (x, top), im if im.mode == "RGBA" else None)
    dr.text((x + 4, 6), "%d %s" % (i + 1, s), font=f, fill=(235, 230, 245))
out.save(os.path.join(d, "crayon_all.png"))
print("crayon_all.png", out.size)
