// =========================
// CONFIG
// =========================
const GOOGLE_API_KEY = "AIzaSyBiMYUtbIXA-5zal571orv0Juz8GUqzF0c";

// =========================
// STATE
// =========================
let waypoints = [];
let map;
let routePolyline;
let elevationChart;

// =========================
// WAYPOINT UI
// =========================
const waypointsListEl = document.getElementById("waypoints-list");
const addWaypointBtn = document.getElementById("add-waypoint-btn");
const buildRouteBtn = document.getElementById("build-route-btn");
const editWaypointsBtn = document.getElementById("edit-waypoints-btn");
const waypointsSection = document.getElementById("waypoints-section");
const routeSection = document.getElementById("route-section");
const summaryEl = document.getElementById("summary");
const mapEl = document.getElementById("map");
const chartCanvas = document.getElementById("elevation-chart");

function renderWaypoints() {
  waypointsListEl.innerHTML = "";
  waypoints.forEach((wp, idx) => {
    const row = document.createElement("div");
    row.className = "waypoint-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = wp.value;
    input.placeholder = "lat,lon / Plus Code / place name";
    input.addEventListener("input", () => {
      waypoints[idx].value = input.value;
    });

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", () => {
      if (idx === 0) return;
      const tmp = waypoints[idx - 1];
      waypoints[idx - 1] = waypoints[idx];
      waypoints[idx] = tmp;
      renderWaypoints();
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = idx === waypoints.length - 1;
    downBtn.addEventListener("click", () => {
      if (idx === waypoints.length - 1) return;
      const tmp = waypoints[idx + 1];
      waypoints[idx + 1] = waypoints[idx];
      waypoints[idx] = tmp;
      renderWaypoints();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      waypoints.splice(idx, 1);
      renderWaypoints();
    });

    row.appendChild(input);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(delBtn);
    waypointsListEl.appendChild(row);
  });
}

addWaypointBtn.addEventListener("click", () => {
  waypoints.push({ value: "" });
  renderWaypoints();
});

// Initialize with two waypoints
waypoints = [{ value: "" }, { value: "" }];
renderWaypoints();

// =========================
// MAP INIT
// =========================
function initMap() {
  map = new google.maps.Map(mapEl, {
    center: { lat: 44, lng: 18 },
    zoom: 7
  });
}

// =========================
// DIRECTIONS + ELEVATION
// =========================
async function buildRoute() {
  const raw = waypoints.map(w => w.value.trim()).filter(v => v.length > 0);
  if (raw.length < 2) {
    alert("Please enter at least 2 waypoints.");
    return;
  }

  const origin = raw[0];
  const destination = raw[raw.length - 1];
  const waypointsParam = raw.slice(1, -1);

  buildRouteBtn.disabled = true;
  buildRouteBtn.textContent = "Building...";

  try {
    // Directions
    const dirParams = new URLSearchParams({
      origin,
      destination,
      key: GOOGLE_API_KEY
    });
    if (waypointsParam.length > 0) {
      dirParams.set("waypoints", waypointsParam.join("|"));
    }

    const dirUrl = "https://maps.googleapis.com/maps/api/directions/json?" + dirParams.toString();
    const dirRes = await fetch(dirUrl);
    const dirJson = await dirRes.json();

    if (dirJson.status !== "OK") {
      throw new Error("Directions error: " + dirJson.status);
    }

    const route = dirJson.routes[0];
    const overviewPolyline = route.overview_polyline.points;

    // Draw route on map
    if (!map) initMap();
    const path = google.maps.geometry.encoding.decodePath(overviewPolyline);
    if (routePolyline) routePolyline.setMap(null);
    routePolyline = new google.maps.Polyline({
      path,
      map,
      geodesic: true,
      strokeColor: "#1976D2",
      strokeWeight: 4,
      strokeOpacity: 0.8
    });

    map.fitBounds(new google.maps.LatLngBounds(
      new google.maps.LatLng(Infinity, Infinity),
      new google.maps.LatLng(-Infinity, -Infinity)
    ));
    for (const latLng of path) {
      const bounds = map.getBounds();
      bounds.extend(latLng);
      map.fitBounds(bounds);
    }

    // Distance & basic stats
    let totalDistanceM = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    // We'll compute ascent/descent from elevation data; distance from Directions
    for (const leg of route.legs) {
      totalDistanceM += leg.distance.value;
    }

    // Elevation along path
    const elevParams = new URLSearchParams({
      path: "enc:" + overviewPolyline,
      samples: "200",
      key: GOOGLE_API_KEY
    });
    const elevUrl = "https://maps.googleapis.com/maps/api/elevation/json?" + elevParams.toString();
    const elevRes = await fetch(elevUrl);
    const elevJson = await elevRes.json();

    if (elevJson.status !== "OK") {
      throw new Error("Elevation error: " + elevJson.status);
    }

    const elevations = elevJson.results.map(r => r.elevation);
    const distances = [];
    const step = totalDistanceM / (elevations.length - 1);
    for (let i = 0; i < elevations.length; i++) {
      distances.push((i * step) / 1000); // km
    }

    // Ascent / descent
    for (let i = 1; i < elevations.length; i++) {
      const dz = elevations[i] - elevations[i - 1];
      if (dz > 0) totalAscent += dz;
      else totalDescent += -dz;
    }

    // Draw elevation chart
    drawElevationChart(distances, elevations);

    // Summary
    summaryEl.innerHTML =
      "Distance: " + (totalDistanceM / 1000).toFixed(1) + " km | " +
      "Ascent: " + Math.round(totalAscent) + " m | " +
      "Descent: " + Math.round(totalDescent) + " m";

    // Switch views
    waypointsSection.style.display = "none";
    routeSection.style.display = "block";
  } catch (e) {
    alert(e.message);
  } finally {
    buildRouteBtn.disabled = false;
    buildRouteBtn.textContent = "Build route";
  }
}

function drawElevationChart(distances, elevations) {
  if (elevationChart) {
    elevationChart.destroy();
  }
  const ctx = chartCanvas.getContext("2d");
  elevationChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: distances.map(d => d.toFixed(1)),
      datasets: [{
        label: "Elevation (m)",
        data: elevations,
        borderColor: "#1976D2",
        backgroundColor: "rgba(25, 118, 210, 0.1)",
        borderWidth: 2,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y.toFixed(0) + " m"
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Distance (km)"
          }
        },
        y: {
          title: {
            display: true,
            text: "Elevation (m)"
          }
        }
      }
    }
  });
}

buildRouteBtn.addEventListener("click", buildRoute);

editWaypointsBtn.addEventListener("click", () => {
  routeSection.style.display = "none";
  waypointsSection.style.display = "block";
  if (map) {
    // keep map, but hide section
  }
});

// Init map when Google script loads
window.initMap = initMap;