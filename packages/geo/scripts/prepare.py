#!/usr/bin/env python3
"""
Step 1 of the map pipeline: turn Natural Earth admin-0 data into the exact set of
country shapes GeoLearn uses (see packages/shared/src/geo/countries.ts for the policy).

Base layer: Natural Earth 10m admin-0 "German point of view" (an EU/UN-aligned view:
Crimea in Ukraine, whole Western Sahara, Northern Cyprus in Cyprus, Somaliland in Somalia).
Then:
  * Golan Heights  -> Syria   (UN Security Council Res. 497)
  * Abyei          -> Sudan   (Natural Earth default; final status undetermined)
  * Bir Tawil      -> Sudan   (south of the 22nd parallel political boundary)
  * Southern Patagonian Ice Field -> Argentina (Natural Earth 1:50m treatment)
  * small leases / zones / SARs merged into their country
  * French Guiana split out of France as its own (territory) piece

Writes cache/entities.geojson with one feature per country id.

Requires: python3 + shapely (pip install shapely)
"""
import json
import os
import sys

from shapely.geometry import shape, mapping, box, Polygon, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', 'cache')


def load(name):
    with open(os.path.join(CACHE, name)) as f:
        data = json.load(f)
    return {feat['properties']['ADM0_A3']: shape(feat['geometry']).buffer(0) for feat in data['features']}


def main():
    wanted = json.loads(sys.argv[1]) if len(sys.argv) > 1 else None
    deu = load('ne_10m_admin_0_countries_deu.geojson')
    default = load('ne_10m_admin_0_countries.geojson')

    geoms = dict(deu)

    # Golan Heights -> Syria.
    golan = default['ISR'].difference(deu['ISR'])
    geoms['SYR'] = unary_union([deu['SYR'], golan])

    # Sudan: default geometry includes Abyei; add Bir Tawil.
    geoms['SDN'] = unary_union([default['SDN'], deu.get('BRT', default['BRT'])])

    # Southern Patagonian Ice Field -> Argentina.
    geoms['ARG'] = unary_union([deu['ARG'], default['SPI']])

    merges = {
        'CYP': ['CNM', 'CYN', 'ESB', 'WSB'],
        'KAZ': ['KAB'],
        'IND': ['KAS'],
        'SOM': ['SOL'],
        'BRA': ['BRI'],
        'CHN': ['HKG', 'MAC'],
        'FIN': ['ALD'],
        'CUB': ['USG'],
    }
    for target, parts in merges.items():
        pieces = [geoms[target]]
        for p in parts:
            g = deu.get(p) or default.get(p)
            if g is not None:
                pieces.append(g)
        geoms[target] = unary_union(pieces)

    # French Guiana out of France.
    guiana_box = box(-55.5, 1.5, -51.0, 6.5)
    geoms['GUF'] = geoms['FRA'].intersection(guiana_box)
    geoms['FRA'] = geoms['FRA'].difference(guiana_box)

    rename = {'KOS': 'XKX', 'PSX': 'PSE', 'SAH': 'ESH', 'SDS': 'SSD'}
    for src, dst in rename.items():
        geoms[dst] = geoms.pop(src)

    features = []
    missing = []
    ids = wanted if wanted is not None else sorted(geoms)
    for cid in ids:
        g = geoms.get(cid)
        if g is None or g.is_empty:
            missing.append(cid)
            continue
        g = g.buffer(0)
        polys = [g] if isinstance(g, Polygon) else [p for p in g.geoms if isinstance(p, Polygon)]
        # d3-geo wants clockwise exterior rings (sign=-1 in shapely's y-up convention).
        polys = [orient(p, sign=-1.0) for p in polys if p.area > 0]
        mp = MultiPolygon(polys)
        features.append({'type': 'Feature', 'properties': {'id': cid}, 'geometry': mapping(mp)})

    if missing:
        print('MISSING:', missing, file=sys.stderr)
        sys.exit(1)

    out = os.path.join(CACHE, 'entities.geojson')
    with open(out, 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f)
    print(f'wrote {len(features)} features -> {out}')


if __name__ == '__main__':
    main()
