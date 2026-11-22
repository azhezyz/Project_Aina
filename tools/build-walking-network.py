"""Build the East Kyoto walking network from local OSM API XML tiles.

Usage: python tools/build-walking-network.py INPUT_TILE_DIRECTORY
The tile extent and metre projection match the existing Kyoto map extract.
Source: https://www.openstreetmap.org/copyright (ODbL 1.0).
"""
import argparse
import base64
from collections import defaultdict
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET


BOUNDS = (135.754, 34.984, 135.795, 35.021)
ROAD_CLASS = {
    **dict.fromkeys(("footway", "path", "steps", "bridleway"), 0),
    **dict.fromkeys(("residential", "unclassified", "living_street", "pedestrian"), 1),
    **dict.fromkeys(("secondary", "secondary_link", "tertiary", "tertiary_link"), 2),
    **dict.fromkeys(("service", "track", "cycleway"), 3),
    **dict.fromkeys(("primary", "primary_link", "trunk", "trunk_link"), 4),
}
DENIED = {"no", "private", "use_sidepath", "customers", "permit", "delivery",
          "agricultural", "forestry"}
FOOT_ALLOWED = {"yes", "designated", "permissive", "official"}


def tags(element):
    return {child.get("k"): child.get("v") for child in element.findall("tag")}


def access_flags(t):
    """Bits 0–2 store road class, bit 3 allows forward, bit 4 allows reverse."""
    h = t.get("highway")
    if h not in ROAD_CLASS or t.get("area") == "yes" or t.get("indoor") == "yes":
        return 0
    if t.get("tunnel") in {"yes", "building_passage"} or t.get("motorroad") == "yes":
        return 0
    foot = t.get("foot")
    if foot in DENIED or (foot not in FOOT_ALLOWED and t.get("access") in DENIED):
        return 0
    if h in {"trunk", "trunk_link", "cycleway", "bridleway"} and foot not in FOOT_ALLOWED:
        if t.get("sidewalk") not in {"yes", "both", "right", "left"}:
            return 0
    if "foot:conditional" in t or (foot not in FOOT_ALLOWED and "access:conditional" in t):
        return 0
    # Vehicle oneway rules do not in themselves limit pedestrians.
    oneway = t.get("oneway:foot")
    forward = oneway != "-1" and t.get("foot:forward") not in DENIED
    reverse = oneway not in {"yes", "1", "true"} and t.get("foot:backward") not in DENIED
    return (ROAD_CLASS[h] | (8 if forward else 0) | (16 if reverse else 0)) if forward or reverse else 0


def node_position(element):
    lng, lat = float(element.get("lon")), float(element.get("lat"))
    if not (BOUNDS[0] <= lng <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
        return None
    t = tags(element)
    foot = t.get("foot")
    if foot in DENIED or (foot not in FOOT_ALLOWED and (
        t.get("access") in DENIED or t.get("barrier") in {"wall", "fence", "hedge", "block"}
        or t.get("locked") == "yes"
    )):
        return None
    return round((lng - 135.77) * 91300), round((35.01 - lat) * 111000)


def build(directory):
    nodes, ways = {}, {}
    for path in sorted(directory.glob("*.osm")):
        for item in ET.parse(path).getroot():
            if item.tag == "node":
                coordinate = node_position(item)
                if coordinate is not None:
                    nodes[int(item.get("id"))] = coordinate
            elif item.tag == "way":
                flags = access_flags(tags(item))
                if flags:
                    ways[int(item.get("id"))] = ([int(nd.get("ref")) for nd in item.findall("nd")], flags)

    neighbors = defaultdict(set)
    edges = set()
    for refs, flags in ways.values():
        for a, b in zip(refs, refs[1:]):
            if a == b or a not in nodes or b not in nodes:
                continue
            neighbors[a].add(b)
            neighbors[b].add(a)
            edges.add((a, b, flags) if a < b else (b, a, (flags & 7) | ((flags & 8) << 1) | ((flags & 16) >> 1)))
    if not edges:
        raise ValueError("No walkable segments found in local Kyoto tiles")
    # Ignore disconnected fragments (e.g. an isolated courtyard or private stairs).
    remaining = set(neighbors)
    core = set()
    while remaining:
        start = remaining.pop()
        component, stack = {start}, [start]
        while stack:
            for other in neighbors[stack.pop()]:
                if other in remaining:
                    remaining.remove(other)
                    component.add(other)
                    stack.append(other)
        if len(component) > len(core):
            core = component

    index = {node: i for i, node in enumerate(sorted(core))}
    if len(index) > 65536:
        raise ValueError("Too many nodes for this regional format")
    vertices = b"".join(struct.pack("<hh", *nodes[n]) for n in index)
    segments = b"".join(struct.pack("<HHB", index[a], index[b], f)
                        for a, b, f in sorted(edges) if a in core)
    return {"bounds": BOUNDS, "vertices": base64.b64encode(vertices).decode(),
            "segments": base64.b64encode(segments).decode()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiles", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "web/walking-network-data.js")
    args = parser.parse_args()
    data = build(args.tiles)
    args.output.write_text("/* Kyoto walkable network © OpenStreetMap contributors. ODbL 1.0. "
                           "https://www.openstreetmap.org/copyright */\nwindow.kyotoWalkingData="
                           + json.dumps(data, separators=(",", ":")) + ";\n", encoding="utf-8")
