"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import L from "leaflet";
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  areaFill,
  areaLocations,
  disasterStyle,
  disasterTypeOf,
  mapKindForEvent,
  shapesForEvent,
} from "@/lib/map-shape";
import { featuresForLocations, type RegionCollection, type RegionFeature } from "@/lib/region-geo";
import type { AlertEvent } from "@/lib/types";

type Props = {
  events: AlertEvent[];
  isolated: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function markerIcon(type: string, selected: boolean) {
  const { color, emoji } = disasterStyle(type);
  const size = selected ? 34 : 28;
  return L.divIcon({
    className: "disaster-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="disaster-marker-dot" style="width:${size}px;height:${size}px;background:${color}">${emoji}</span>`,
  });
}

function MapFocus({
  isolated,
  features,
  points,
}: {
  isolated: boolean;
  features: RegionFeature[];
  points: Array<[number, number]>;
}) {
  const map = useMap();
  const signature = `${features.map((feature) => feature.properties.code).join(",")}:${points.join(";")}`;

  useEffect(() => {
    if (!isolated) {
      map.setView([36.4, 127.8], 7);
    }
  }, [isolated, map]);

  useEffect(() => {
    if (!isolated) return;
    const bounds = L.latLngBounds([]);
    if (features.length > 0) {
      bounds.extend(L.geoJSON({ type: "FeatureCollection", features } as FeatureCollection).getBounds());
    }
    for (const [lat, lng] of points) bounds.extend([lat, lng]);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
    }
  }, [map, isolated, signature, features, points]);

  return null;
}

export function AlertMap({ events, isolated, selectedId, onSelect }: Props) {
  const [geo, setGeo] = useState<RegionCollection | null>(null);

  useEffect(() => {
    void fetch("/geo/kr-regions.json")
      .then((response) => response.json())
      .then((data: RegionCollection) => setGeo(data))
      .catch(() => setGeo(null));
  }, []);

  const painted = useMemo(() => {
    if (!geo) return [] as Array<{ event: AlertEvent; feature: RegionFeature }>;
    const byCode = new Map<string, { event: AlertEvent; feature: RegionFeature }>();
    const areaEvents = events.filter((event) => mapKindForEvent(event) === "area");
    for (const event of areaEvents) {
      for (const feature of featuresForLocations(areaLocations(event), geo)) {
        if (!byCode.has(feature.properties.code)) {
          byCode.set(feature.properties.code, { event, feature });
        }
      }
    }
    return [...byCode.values()];
  }, [events, geo]);

  const collection = useMemo<RegionCollection>(
    () => ({ type: "FeatureCollection", features: painted.map((row) => row.feature) }),
    [painted],
  );

  const eventByCode = useMemo(() => {
    const map = new Map<string, AlertEvent>();
    for (const row of painted) map.set(row.feature.properties.code, row.event);
    return map;
  }, [painted]);

  const points = events
    .filter((event) => mapKindForEvent(event) === "point")
    .map((event) => {
      const shape = shapesForEvent(event)[0];
      if (!shape) return null;
      return { event, shape };
    })
    .filter((row): row is { event: AlertEvent; shape: NonNullable<ReturnType<typeof shapesForEvent>[0]> } =>
      Boolean(row),
    );

  return (
    <MapContainer
      center={[36.4, 127.8]}
      zoom={7}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapFocus
        isolated={isolated}
        features={collection.features}
        points={points.map((row) => [row.shape.lat, row.shape.lng])}
      />
      {collection.features.length > 0 ? (
        <GeoJSON
          key={`${isolated ? selectedId : "all"}:${collection.features
            .map((feature) => `${eventByCode.get(feature.properties.code)?.id ?? ""}:${feature.properties.code}`)
            .join("-")}`}
          data={collection as FeatureCollection}
          style={(feature) => {
            const code = (feature?.properties as { code?: string } | undefined)?.code;
            const event = code ? eventByCode.get(code) : undefined;
            const selected = event?.id === selectedId;
            const color = event ? areaFill(event) : "#64748b";
            return {
              color,
              fillColor: color,
              fillOpacity: isolated || selected ? 0.45 : 0.28,
              weight: isolated || selected ? 2 : 1,
              opacity: 0.9,
            };
          }}
          onEachFeature={(feature, layer) => {
            const code = (feature.properties as { code?: string } | undefined)?.code;
            const event = code ? eventByCode.get(code) : undefined;
            if (!event) return;
            layer.on("click", () => onSelect(event.id));
            layer.bindPopup(
              `<strong>${disasterTypeOf(event)}</strong><br/>${(event.llm?.summary ?? event.rawText).slice(0, 80)}`,
            );
          }}
        />
      ) : null}
      {points.map(({ event, shape }) => {
        const selected = event.id === selectedId || isolated;
        const type = disasterTypeOf(event);
        return (
          <Marker
            key={event.id}
            position={[shape.lat, shape.lng]}
            icon={markerIcon(type, selected)}
            eventHandlers={{ click: () => onSelect(event.id) }}
            zIndexOffset={selected ? 600 : 0}
          >
            <Popup>
              <div className="min-w-40 text-sm text-slate-900">
                <strong>
                  {disasterStyle(type).emoji} {type}
                </strong>
                <p className="mt-1">{event.llm?.summary ?? event.rawText.slice(0, 80)}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
