// Simple point-in-polygon using ray casting algorithm
// Loads council district GeoJSON once and caches in memory

interface DistrictFeature {
  type: "Feature"
  properties: Record<string, unknown>
  geometry: {
    type: "Polygon" | "MultiPolygon"
    coordinates: number[][][] | number[][][][]
  }
}

interface DistrictCollection {
  type: "FeatureCollection"
  features: DistrictFeature[]
}

let districtData: DistrictCollection | null = null

async function loadDistricts(): Promise<DistrictCollection> {
  if (districtData) return districtData

  // NYC ArcGIS FeatureServer — returns all 51 council district polygons as GeoJSON
  const res = await fetch(
    "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=CounDist&f=geojson&resultRecordCount=100",
    { next: { revalidate: 86400 * 30 } }
  )

  if (!res.ok) {
    throw new Error(`Failed to load council district GeoJSON: ${res.status}`)
  }

  districtData = await res.json() as DistrictCollection
  return districtData
}

// Ray casting algorithm for point-in-polygon
// GeoJSON coordinates are [lng, lat], so we compare against lng for x and lat for y
function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]

    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pointInGeometry(lat: number, lng: number, geometry: DistrictFeature["geometry"]): boolean {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][]
    return pointInPolygon(lat, lng, rings[0])
  }

  if (geometry.type === "MultiPolygon") {
    const polygons = geometry.coordinates as number[][][][]
    for (const polygon of polygons) {
      if (pointInPolygon(lat, lng, polygon[0])) return true
    }
  }

  return false
}

export async function findCouncilDistrict(lat: number, lng: number): Promise<number | null> {
  const data = await loadDistricts()

  for (const feature of data.features) {
    if (pointInGeometry(lat, lng, feature.geometry)) {
      const props = feature.properties
      const district = props.CounDist || props.coun_dist || props.COUNDIST ||
        props.council_district || props.district
      if (district) return parseInt(String(district))
    }
  }

  return null
}
