"""Bake the Earth textures in ../../assets/earth/ from NASA public-domain sources.

Run once; the outputs are committed. The sources are large and are not kept here:

  day_5400.jpg     Blue Marble Next Generation, July 2004
                   eoimages.gsfc.nasa.gov/images/imagerecords/74000/74092/world.200407.3x5400x2700.jpg
  night_3km.jpg    Black Marble 2016
                   eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
  clouds_8192.tif  Blue Marble clouds
                   eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif
  elev_21600.png   GEBCO elevation
                   eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png
  bath_21600.png   GEBCO bathymetry (land is palette index 255)
                   eoimages.gsfc.nasa.gov/images/imagerecords/73000/73963/gebco_08_rev_bath_21600x10800.png

usage: python make_textures.py <folder with the sources>
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter

Image.MAX_IMAGE_PIXELS = None

SRC = sys.argv[1]
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'earth'))
os.makedirs(OUT, exist_ok=True)

BIG = (4096, 2048)
SMALL = (2048, 1024)


def save(im, name, quality=88):
    path = os.path.join(OUT, name)
    im.save(path, 'JPEG', quality=quality, optimize=True, progressive=True)
    print(f'{name:12s} {im.size[0]}x{im.size[1]} {im.mode:3s} {os.path.getsize(path) / 1024:8.0f} KB')


def lut(fn):
    return [max(0, min(255, round(fn(v)))) for v in range(256)]


# day: straight resample, colour stays as NASA shot it; the shader grades it
day_src = Image.open(os.path.join(SRC, 'day_5400.jpg')).convert('RGB')
day = day_src.resize(BIG, Image.LANCZOS)
save(day, 'day.jpg', 90)

# night: keep the lights, drop Black Marble's moonlit blue land and sea.
# lights are warm or white (min(R,G) high, blue not dominant); the base is blue.
# extracted at full resolution, then averaged down, so small towns survive as dim
# points instead of being thresholded away after the average
night_src = Image.open(os.path.join(SRC, 'night_3km.jpg')).convert('RGB')
r, g, b = night_src.split()
rg_min = ImageChops.darker(r, g)
blue_excess = ImageChops.subtract(b, rg_min)                 # max(0, B - min(R,G))
lights = ImageChops.subtract(rg_min, blue_excess.point(lut(lambda v: v * 1.5)))
lights = lights.point(lut(lambda v: 0 if v <= 44 else 255 * min(1.0, (v - 44) / 170)))
lights = lights.resize(BIG, Image.BOX).point(lut(lambda v: 255 * (v / 255) ** 0.62))
save(lights, 'night.jpg', 90)

# clouds: grey coverage, 0 = clear. the source has a ~10-20 grey floor of sensor
# noise over clear sky, which would haze the whole planet; levels take it out.
clouds = Image.open(os.path.join(SRC, 'clouds_8192.tif')).convert('L').resize(BIG, Image.LANCZOS)
clouds = clouds.point(lut(lambda v: 0 if v <= 22 else 255 * min(1.0, (v - 22) / 218) ** 0.9))
save(clouds, 'clouds.jpg', 84)

# relief: land elevation, 0 at sea level; a little gamma so lowlands still read
elev = Image.open(os.path.join(SRC, 'elev_21600.png')).convert('L').resize(SMALL, Image.BOX)
relief = elev.point(lut(lambda v: 255 * (v / 255) ** 0.7))
save(relief, 'relief.jpg', 90)

# water: GEBCO bathymetry (ocean, Caspian, Dead Sea) OR near-black blue in the day map
# (catches the Great Lakes and other lakes GEBCO leaves out). 255 = water.
bath = Image.open(os.path.join(SRC, 'bath_21600.png'))
bath_idx = bath.convert('L') if bath.mode != 'P' else Image.frombytes('L', bath.size, bath.tobytes())
bath_water = bath_idx.resize(BIG, Image.NEAREST).point(lut(lambda v: 0 if v == 255 else 255))
dr, dg, db = day.split()
dark = ImageChops.lighter(dr, dg).point(lut(lambda v: 255 if v < 14 else 0))
bluish = ImageChops.subtract(db, dr).point(lut(lambda v: 255 if v >= 2 else 0))
lake = ImageChops.multiply(dark, bluish)
water = ImageChops.lighter(bath_water, lake).filter(ImageFilter.GaussianBlur(1.2)).resize(SMALL, Image.LANCZOS)
save(water, 'water.jpg', 90)

# a quick sanity print at a few places (value 0..255)
def at(im, lon, lat):
    w, h = im.size
    return im.getpixel((int((lon + 180) / 360 * (w - 1)), int((90 - lat) / 180 * (h - 1))))

for name, (lon, lat) in {'pacific': (-150, 0), 'great_lakes': (-87, 44), 'caspian': (51, 42), 'sahara': (10, 23),
                         'nether': (5.0, 52.3), 'tokyo': (139.7, 35.7), 'antarctic': (0, -85)}.items():
    print(f'  {name:12s} water={at(water, lon, lat):3d} lights={at(lights, lon, lat):3d} relief={at(relief, lon, lat):3d}')
