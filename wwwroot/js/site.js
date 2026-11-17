/* MUSAFIR API-FIRST FRONTEND BASE
   Cities: Open-Meteo Geocoding (GeoNames data)
   Places: OpenStreetMap Overpass API
   Road routing: OSRM public demo server
   This file is frontend-only. Move API calls into C# services/controllers when backend work begins.
*/
(() => {
    'use strict';

    const API = {
        geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
        // Public Overpass instances can become overloaded. Try the primary, then a documented global mirror.
        overpass: [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.private.coffee/api/interpreter',
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
        ],
        routing: 'https://router.project-osrm.org/route/v1/driving'
    };

    // Illustrative estimation assumptions only. Adjust these after researching local operators.
    const FARE_MODEL = {
        busBasePKR: 450,
        busPerKmPerPersonPKR: 3.2,
        carFuelPricePKRPerLitre: 280,
        carKmPerLitre: 12,
        carRunningCostPKRPerKm: 5,
        carTollEstimatePKRPerKm: 1.2,
        flightBasePKR: 4500,
        flightPerAirKmPKR: 42,
        flightCruiseKmh: 750,
        flightAirportBufferHours: 2.5
    };

    const cityCache = new Map();
    let searchTimer;
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtPKR = value => 'Rs. ' + Math.round(value).toLocaleString('en-PK');
    const fmtDistance = metres => metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
    const fmtDuration = seconds => {
        const mins = Math.round(seconds / 60), hours = Math.floor(mins / 60), rem = mins % 60;
        return hours ? `${hours} hr ${rem} min` : `${rem} min`;
    };

    document.addEventListener('DOMContentLoaded', () => {
        initRevealAnimations();
        initCitySearchInputs();
        initRoutePlanner();
        initExploreDirectory();
        initComparison();
    });

    function initRevealAnimations() {
        const items = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) { items.forEach(x => x.classList.add('is-visible')); return; }
        const observer = new IntersectionObserver(entries => entries.forEach(entry => {
            if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
        }), { threshold: 0.1 });
        items.forEach(item => observer.observe(item));
    }

    function initCitySearchInputs() {
        document.querySelectorAll('.city-input').forEach(input => {
            input.addEventListener('input', () => {
                clearTimeout(searchTimer);
                const query = input.value.trim();
                if (query.length < 2) return;
                searchTimer = setTimeout(() => searchCities(query, input), 380);
            });
        });
    }

    async function searchCities(query, input) {
        const listId = input.getAttribute('list');
        const datalist = listId ? $(listId) : null;
        if (!datalist) return;
        try {
            const url = new URL(API.geocoding);
            url.search = new URLSearchParams({ name: query, count: '12', language: 'en', format: 'json', countryCode: 'PK' });
            const response = await fetch(url);
            if (!response.ok) throw new Error(`City search failed (${response.status})`);
            const data = await response.json();
            const results = (data.results || []).filter(place => place.country_code === 'PK');
            datalist.replaceChildren();
            results.forEach(place => {
                const label = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}, Pakistan`;
                const option = document.createElement('option'); option.value = label; datalist.appendChild(option);
                cityCache.set(normalizeCity(label), normalizePlace(place));
                cityCache.set(normalizeCity(place.name), normalizePlace(place));
            });
            if (!results.length) setStatus(input.closest('form')?.querySelector('.api-status') || $('exploreStatus'), 'No matching Pakistani city found. Try another spelling.', 'warning');
        } catch (error) {
            console.error(error);
            setStatus(input.closest('form')?.querySelector('.api-status') || $('exploreStatus'), 'City search is temporarily unavailable. Please try again.', 'error');
        }
    }

    function normalizePlace(place) {
        return {
            id: place.id, name: place.name, admin1: place.admin1 || '', country: place.country || 'Pakistan',
            latitude: Number(place.latitude), longitude: Number(place.longitude), population: place.population || null,
            timezone: place.timezone || ''
        };
    }
    const normalizeCity = value => String(value).toLowerCase().replace(/,\s*pakistan$/, '').trim();

    async function resolveCity(value) {
        const cached = cityCache.get(normalizeCity(value));
        if (cached) return cached;
        const query = value.trim().replace(/,\s*pakistan$/i, '');
        if (!query) throw new Error('Enter a city name.');
        const url = new URL(API.geocoding);
        url.search = new URLSearchParams({ name: query, count: '10', language: 'en', format: 'json', countryCode: 'PK' });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not look up that city.');
        const data = await response.json();
        const match = (data.results || []).find(p => p.country_code === 'PK' && (p.name.toLowerCase() === query.split(',')[0].trim().toLowerCase()))
            || (data.results || []).find(p => p.country_code === 'PK');
        if (!match) throw new Error(`No Pakistani city matched “${query}”. Select a result from the suggestions.`);
        const city = normalizePlace(match);
        cityCache.set(normalizeCity(value), city);
        cityCache.set(normalizeCity(city.name), city);
        return city;
    }

    function initRoutePlanner() {
        const form = $('routeForm');
        const stopsList = $('stopsList');
        if (!form || !stopsList) return;
        $('addStop')?.addEventListener('click', () => {
            const field = document.createElement('div'); field.className = 'route-field stop-field stop-added';
            field.innerHTML = `<span class="field-step">+</span><div class="flex-grow-1"><label class="form-label">Intermediate stop <small class="optional-label">OPTIONAL</small></label><input class="form-control city-input stop-input" list="citySuggestions" placeholder="Search another city" autocomplete="off"></div><button type="button" class="remove-stop" aria-label="Remove stop">×</button><span class="route-node"></span>`;
            stopsList.appendChild(field);
            const input = field.querySelector('input');
            input.addEventListener('input', () => {
                clearTimeout(searchTimer); const q = input.value.trim();
                if (q.length >= 2) searchTimer = setTimeout(() => searchCities(q, input), 380);
            });
            input.focus();
        });
        stopsList.addEventListener('click', e => { if (e.target.closest('.remove-stop')) e.target.closest('.route-field').remove(); });
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const button = $('buildRoute'); button.disabled = true; button.textContent = 'Calculating route…';
            setStatus($('plannerStatus'), 'Finding city coordinates and requesting road directions…', 'loading');
            try {
                const rawNames = [$('origin').value, ...[...document.querySelectorAll('.stop-input')].map(x => x.value).filter(Boolean), $('destination').value];
                if (rawNames.length < 2 || rawNames.some(x => !x.trim())) throw new Error('Please enter an origin and destination.');
                const cities = [];
                for (const name of rawNames) cities.push(await resolveCity(name));
                const route = await getRoadRoute(cities);
                const legs = route.legs.map((leg, index) => ({
                    from: cities[index], to: cities[index + 1], distanceMetres: leg.distance,
                    durationSeconds: leg.duration
                }));
                const plan = {
                    cities, legs, totalDistanceMetres: route.distance, totalDurationSeconds: route.duration,
                    date: $('travelDate').value || '', travellers: Number($('travellers').value || 1), savedAt: new Date().toISOString()
                };
                localStorage.setItem('musafirRoutePlan', JSON.stringify(plan));
                renderRoutePlan(plan);
                setStatus($('plannerStatus'), 'Route calculated successfully. You can now compare transport estimates.', 'success');
                $('routeStatusTag').textContent = 'ROUTE CALCULATED';
            } catch (error) {
                console.error(error); setStatus($('plannerStatus'), error.message || 'Unable to calculate this route. Please try again.', 'error');
            } finally { button.disabled = false; button.innerHTML = 'Calculate route legs <span class="ms-2">↗</span>'; }
        });
        try { const saved = JSON.parse(localStorage.getItem('musafirRoutePlan') || 'null'); if (saved) renderRoutePlan(saved); } catch (_) { }
    }

    async function getRoadRoute(cities) {
        if (cities.length < 2) throw new Error('A route needs at least two cities.');
        const coordinates = cities.map(c => `${c.longitude},${c.latitude}`).join(';');
        const url = `${API.routing}/${coordinates}?overview=false&steps=false&alternatives=false`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('The routing service could not calculate this route. Try again shortly.');
        const data = await response.json();
        if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route was found for these locations.');
        return data.routes[0];
    }

    function renderRoutePlan(plan) {
        if (!$('routePreview')) return;
        $('routeTitle').innerHTML = `${esc(plan.cities[0].name)} <em>to</em> ${esc(plan.cities[plan.cities.length - 1].name)}`;
        const preview = $('routePreview'); preview.replaceChildren();
        plan.cities.forEach((city, index) => {
            const row = document.createElement('div'); row.className = 'preview-stop';
            row.innerHTML = `<span class="preview-dot ${index === 0 ? 'filled' : index === plan.cities.length - 1 ? 'end-dot' : ''}"></span><div><small>${index === 0 ? 'ORIGIN' : index === plan.cities.length - 1 ? 'DESTINATION' : 'INTERMEDIATE STOP'}</small><strong>${esc(city.name)}</strong><span class="city-subline">${esc(city.admin1)}, Pakistan</span></div><span class="stop-code">${city.latitude.toFixed(2)}, ${city.longitude.toFixed(2)}</span>`;
            preview.appendChild(row);
            if (index < plan.legs.length) {
                const leg = plan.legs[index]; const line = document.createElement('div'); line.className = 'preview-leg';
                line.innerHTML = `<span>LEG ${String(index + 1).padStart(2, '0')}</span><i></i><small>${fmtDistance(leg.distanceMetres)} · approx. ${fmtDuration(leg.durationSeconds)}</small>`;
                preview.appendChild(line);
            }
        });
        $('legCount').textContent = plan.legs.length;
        $('totalDistance').textContent = fmtDistance(plan.totalDistanceMetres);
    }

    function initExploreDirectory() {
        const button = $('loadCity'); if (!button) return;
        button.addEventListener('click', loadExploreCity);
        $('exploreCity').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadExploreCity(); } });
    }

    async function loadExploreCity() {
        const input = $('exploreCity'); const button = $('loadCity');
        if (!input.value.trim()) { setStatus($('exploreStatus'), 'Enter a Pakistani city first.', 'warning'); return; }
        button.disabled = true; button.textContent = 'Loading…';
        setStatus($('exploreStatus'), 'Looking up the city and searching OpenStreetMap places nearby…', 'loading');
        try {
            const city = await resolveCity(input.value);
            $('cityTitle').innerHTML = `${esc(city.name)}, <em>${esc(city.admin1 || 'Pakistan')}.</em>`;
            $('cityDescription').textContent = `Explore mapped attractions and practical places around ${city.name}. Results are retrieved from OpenStreetMap and depend on community map coverage.`;
            $('cityRegion').textContent = city.admin1 || 'Pakistan';
            $('cityCoordinates').textContent = `${city.latitude.toFixed(3)}, ${city.longitude.toFixed(3)}`;
            $('cityMapLink').href = `https://www.openstreetmap.org/?mlat=${city.latitude}&mlon=${city.longitude}#map=12/${city.latitude}/${city.longitude}`;
            const places = await fetchNearbyPlaces(city);
            renderPlaces(places);
            setStatus($('exploreStatus'), `Loaded ${places.attractions.length} attractions and ${places.services.length} practical places near ${city.name}.`, 'success');
        } catch (error) {
            console.error(error); setStatus($('exploreStatus'), error.message || 'Could not load places. Please try again.', 'error');
        } finally { button.disabled = false; button.textContent = 'Explore city ↗'; }
    }

    async function fetchNearbyPlaces(city) {
        const q = `[out:json][timeout:25];(\n      node(around:7000,${city.latitude},${city.longitude})[tourism~"^(attraction|museum|viewpoint|zoo|theme_park|artwork)$"];\n      way(around:7000,${city.latitude},${city.longitude})[tourism~"^(attraction|museum|viewpoint|zoo|theme_park|artwork)$"];\n      relation(around:7000,${city.latitude},${city.longitude})[tourism~"^(attraction|museum|viewpoint|zoo|theme_park|artwork)$"];\n      node(around:7000,${city.latitude},${city.longitude})[historic];\n      way(around:7000,${city.latitude},${city.longitude})[historic];\n      node(around:7000,${city.latitude},${city.longitude})[tourism~"^(hotel|hostel|guest_house)$"];\n      way(around:7000,${city.latitude},${city.longitude})[tourism~"^(hotel|hostel|guest_house)$"];\n      node(around:7000,${city.latitude},${city.longitude})[amenity~"^(bus_station|taxi|car_rental)$"];\n      way(around:7000,${city.latitude},${city.longitude})[amenity~"^(bus_station|taxi|car_rental)$"];\n    );out center tags;`;
        // Try public instances one at a time. A 502/503/504 usually means that
        // one server is overloaded; it does not mean the city has no places.
        let data = null;
        const failures = [];
        for (const endpoint of API.overpass) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                    body: new URLSearchParams({ data: q })
                });
                if (!response.ok) {
                    failures.push(`${new URL(endpoint).hostname}: HTTP ${response.status}`);
                    // Do not keep hammering a busy endpoint. Move to the next mirror.
                    continue;
                }
                data = await response.json();
                break;
            } catch (error) {
                failures.push(`${new URL(endpoint).hostname}: ${error.message || 'network error'}`);
            }
        }
        if (!data) {
            throw new Error('The free places services are temporarily unavailable. Please wait 30–60 seconds and try again. This is an API availability issue, not a problem with your city search.');
        }
        const attractions = [], services = [], seen = new Set();
        (data.elements || []).forEach(el => {
            const tags = el.tags || {}; const name = tags.name || tags['name:en'];
            if (!name) return;
            const key = `${el.type}-${el.id}`; if (seen.has(key)) return; seen.add(key);
            const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
            if (lat == null || lon == null) return;
            const item = { name, category: tags.tourism || tags.historic || tags.amenity || 'place', lat, lon, address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', '), website: tags.website || tags['contact:website'] || '', phone: tags.phone || tags['contact:phone'] || '' };
            if (tags.tourism === 'hotel' || tags.tourism === 'hostel' || tags.tourism === 'guest_house' || ['bus_station', 'taxi', 'car_rental'].includes(tags.amenity)) services.push(item);
            else attractions.push(item);
        });
        return { attractions: attractions.slice(0, 30), services: services.slice(0, 24) };
    }

    function renderPlaces(places) {
        $('placesCount').textContent = `${places.attractions.length} attractions · ${places.services.length} practical places`;
        const attractionGrid = $('attractionsGrid'), servicesGrid = $('servicesGrid');
        attractionGrid.replaceChildren(); servicesGrid.replaceChildren();
        appendPlaceCards(attractionGrid, places.attractions, 'No named attractions were found in this area. Try another city or check OpenStreetMap coverage.');
        appendPlaceCards(servicesGrid, places.services, 'No named hotels or local transport places were found nearby.');
    }

    function appendPlaceCards(container, items, emptyMessage) {
        if (!items.length) { container.innerHTML = `<div class="col-12"><div class="empty-api-state">${esc(emptyMessage)}</div></div>`; return; }
        items.forEach(item => {
            const col = document.createElement('div'); col.className = 'col-md-6 col-xl-4';
            const mapUrl = `https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=17/${item.lat}/${item.lon}`;
            const extra = item.address ? `<p class="place-address">${esc(item.address)}</p>` : '';
            const site = item.website ? `<a class="place-action" href="${esc(/^https?:\/\//i.test(item.website) ? item.website : 'https://' + item.website)}" target="_blank" rel="noopener">Website ↗</a>` : '';
            col.innerHTML = `<article class="directory-card api-place-card"><div class="directory-icon">✳</div><span class="place-category">${esc(String(item.category).replaceAll('_', ' '))}</span><h3>${esc(item.name)}</h3>${extra}<p class="place-coordinates">${Number(item.lat).toFixed(4)}, ${Number(item.lon).toFixed(4)}</p><div class="place-actions"><a class="text-link" href="${mapUrl}" target="_blank" rel="noopener">View on map ↗</a>${site}</div></article>`;
            container.appendChild(col);
        });
    }

    async function initComparison() {
        if (!$('transportCards')) return;
        let plan;
        try { plan = JSON.parse(localStorage.getItem('musafirRoutePlan') || 'null'); } catch (_) { }
        if (!plan?.cities?.length || !plan?.legs?.length) {
            setStatus($('compareStatus'), 'No saved route yet. Open Plan a Trip, select your cities and calculate the route first.', 'warning');
            return;
        }
        $('compareOrigin').textContent = plan.cities[0].name;
        $('compareDestination').textContent = plan.cities[plan.cities.length - 1].name;
        $('compareDistance').textContent = `Distance: ${fmtDistance(plan.totalDistanceMetres)}`;
        $('compareDuration').textContent = `Road time: ${fmtDuration(plan.totalDurationSeconds)}`;
        const travellers = Math.max(1, Number(plan.travellers || 1));
        const totals = { bus: 0, flight: 0, car: 0 };
        const legCards = plan.legs.map((leg, index) => {
            const km = leg.distanceMetres / 1000;
            const airKm = haversineKm(leg.from.latitude, leg.from.longitude, leg.to.latitude, leg.to.longitude);
            const bus = (FARE_MODEL.busBasePKR + km * FARE_MODEL.busPerKmPerPersonPKR) * travellers;
            const car = (km / FARE_MODEL.carKmPerLitre * FARE_MODEL.carFuelPricePKRPerLitre) + km * (FARE_MODEL.carRunningCostPKRPerKm + FARE_MODEL.carTollEstimatePKRPerKm);
            const flight = (FARE_MODEL.flightBasePKR + airKm * FARE_MODEL.flightPerAirKmPKR) * travellers;
            const flightHours = airKm / FARE_MODEL.flightCruiseKmh + FARE_MODEL.flightAirportBufferHours;
            totals.bus += bus; totals.car += car; totals.flight += flight;
            return { index, leg, km, airKm, bus, car, flight, flightHours };
        });
        const routeDurationHours = plan.totalDurationSeconds / 3600;
        const flightDurationHours = legCards.reduce((sum, leg) => sum + leg.flightHours, 0);
        $('transportCards').innerHTML = `
      <div class="col-lg-4 reveal is-visible"><article class="transport-card bus-card"><div class="transport-card-head"><span class="transport-symbol">▰</span><span class="mode-index">01 / ROAD</span></div><h3>Intercity bus</h3><p class="transport-description">Estimated passenger fare using a configurable base fare and per-kilometre rate.</p><div class="transport-metrics"><div><small>ESTIMATED TOTAL · ${travellers} TRAVELLER(S)</small><strong>${fmtPKR(totals.bus)} <i>/ group</i></strong></div><div><small>ROAD DURATION</small><strong>${fmtDuration(plan.totalDurationSeconds)}</strong></div></div><div class="transport-foot"><span>Rate assumption: Rs ${FARE_MODEL.busPerKmPerPersonPKR}/km/person + base</span></div></article></div>
      <div class="col-lg-4 reveal is-visible"><article class="transport-card flight-card"><div class="transport-card-head"><span class="transport-symbol">✈</span><span class="mode-index">02 / AIR</span></div><h3>Flight</h3><p class="transport-description">Indicative straight-line distance fare model. Not a live airline quote or confirmed route.</p><div class="transport-metrics"><div><small>ESTIMATED TOTAL · ${travellers} TRAVELLER(S)</small><strong>${fmtPKR(totals.flight)} <i>/ group</i></strong></div><div><small>MODELLED AIR TRAVEL + BUFFER</small><strong>${fmtDuration(flightDurationHours * 3600)}</strong></div></div><div class="transport-foot"><span>Airport buffer included · availability not checked</span></div></article></div>
      <div class="col-lg-4 reveal is-visible"><article class="transport-card car-card"><div class="transport-card-head"><span class="transport-symbol">⌁</span><span class="mode-index">03 / DRIVE</span></div><h3>Private car</h3><p class="transport-description">Estimated vehicle cost from fuel consumption, fuel price and per-kilometre running/toll allowances.</p><div class="transport-metrics"><div><small>ESTIMATED TRIP COST</small><strong>${fmtPKR(totals.car)} <i>/ vehicle</i></strong></div><div><small>ROAD DURATION</small><strong>${fmtDuration(plan.totalDurationSeconds)}</strong></div></div><div class="transport-foot"><span>${FARE_MODEL.carKmPerLitre} km/L · Rs ${FARE_MODEL.carFuelPricePKRPerLitre}/L assumed</span></div></article></div>`;
        $('compareLegs').innerHTML = legCards.map(item => `<div class="leg-row"><span class="leg-index">${String(item.index + 1).padStart(2, '0')}</span><div class="leg-route"><strong>${esc(item.leg.from.name)}</strong><span>→</span><strong>${esc(item.leg.to.name)}</strong></div><span class="leg-status">${fmtDistance(item.leg.distanceMetres)} · ${fmtDuration(item.leg.durationSeconds)}</span><div class="leg-estimate-line"><span>Bus ${fmtPKR(item.bus)}</span><span>Flight ${fmtPKR(item.flight)}</span><span>Car ${fmtPKR(item.car)}</span></div></div>`).join('');
        setStatus($('compareStatus'), `Estimates calculated from ${plan.legs.length} road segment(s). Rates are editable in js/app.js.`, 'success');
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const rad = x => x * Math.PI / 180; const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function setStatus(element, message, type = 'info') {
        if (!element) return;
        element.textContent = message;
        element.className = `api-status ${type}`;
    }
})();
