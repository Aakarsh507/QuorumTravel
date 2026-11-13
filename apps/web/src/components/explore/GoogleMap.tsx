import { useEffect, useRef } from "react";
import type { ExplorePlace } from "../../services/googleMaps";

interface Props {
  selectedPlace: ExplorePlace | null;
  onError: () => void;
}

export function GoogleMap({ selectedPlace, onError }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    const container = element.current;
    if (!container) return;
    try {
      map.current = new google.maps.Map(container, {
        center: { lat: 20, lng: 0 }, zoom: 2,
        mapId: "DEMO_MAP_ID", streetViewControl: false, mapTypeControl: false,
        gestureHandling: "cooperative",
      });
    } catch {
      onError();
    }
    return () => {
      map.current = null;
      container.replaceChildren();
    };
  }, [onError]);

  useEffect(() => {
    if (!selectedPlace || !map.current) return;
    let marker: google.maps.marker.AdvancedMarkerElement | undefined;
    try {
      const position = { lat: selectedPlace.latitude, lng: selectedPlace.longitude };
      marker = new google.maps.marker.AdvancedMarkerElement({
        map: map.current, position, title: selectedPlace.name,
      });
      map.current.panTo(position);
      map.current.setZoom(15);
    } catch {
      onError();
    }
    return () => { if (marker) marker.map = null; };
  }, [selectedPlace, onError]);

  return <div className="explore-map" ref={element} aria-label="Interactive Google map of the selected place" />;
}
