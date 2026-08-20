(function () {
  const ROLE_COLORS = {
    lbnl_led: '#007681',
    partner_led: '#74AA50',
  };
  const ROLE_LABELS = {
    lbnl_led: 'LBNL-led project',
    partner_led: 'Partner-led project',
  };
  const LBNL_KEY = 'lawrence-berkeley-national-laboratory';

  const map = L.map('map', {
    minZoom: 3,
    maxZoom: 8,
    maxBounds: [[5, -170], [72, 10]],
    maxBoundsViscosity: 0.6,
  }).setView([39.5, -98.5], 4);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  const statePane = map.createPane('statePane');
  statePane.style.zIndex = 350;
  statePane.style.pointerEvents = 'none';
  const arcPane = map.createPane('arcPane');
  arcPane.style.zIndex = 410;
  const markerPane = map.createPane('markerPane2');
  markerPane.style.zIndex = 420;

  const STATE_ABBR_TO_NAME = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  };
  const STATE_BASE_STYLE = { color: '#cbd5e1', weight: 0.6, opacity: 0.5, fill: false };
  const STATE_HIGHLIGHT_STYLE = { color: '#1e293b', weight: 2, opacity: 0.9, fill: false };
  let stateLayer = null;

  fetch('https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI/data/geojson/us-states.json')
    .then((res) => res.json())
    .then((geojson) => {
      stateLayer = L.geoJSON(geojson, {
        pane: 'statePane',
        style: STATE_BASE_STYLE,
      }).addTo(map);
    })
    .catch(() => {});

  function highlightStatesForKeys(institutionKeys) {
    if (!stateLayer) return;
    const stateNames = new Set();
    (institutionKeys || []).forEach((key) => {
      const inst = institutions[key];
      const abbr = inst && deriveState(inst.city);
      if (abbr && STATE_ABBR_TO_NAME[abbr]) stateNames.add(STATE_ABBR_TO_NAME[abbr]);
    });
    stateLayer.eachLayer((layer) => {
      const isMatch = stateNames.has(layer.feature.properties.name);
      layer.setStyle(isMatch ? STATE_HIGHLIGHT_STYLE : STATE_BASE_STYLE);
    });
  }

  let layerGroup = L.layerGroup().addTo(map);
  let currentRole = 'lbnl_led';
  let institutions = null;
  let projects = null;
  let projectEntries = new Map(); // id -> { project, arcs, hitArcs, institutionKeys, highlight, reset }
  let selectedProjectId = null;
  let filters = { search: '', topic: '', state: '', institution: '' };
  let openTooltipMarkers = [];

  const TOOLTIP_LAYOUTS = [
    { direction: 'top', offset: [0, -6] },
    { direction: 'bottom', offset: [0, 10] },
    { direction: 'right', offset: [8, 0] },
    { direction: 'left', offset: [-8, 0] },
  ];
  const TOOLTIP_COLLISION_PX = 70;

  map.on('zoomend moveend', () => {
    if (openTooltipMarkers.length) layoutTooltips(openTooltipMarkers);
  });

  const detailPanel = document.getElementById('detail-panel');
  const detailEmpty = document.getElementById('detail-empty');
  const detailContent = document.getElementById('detail-content');
  const listPanel = document.getElementById('project-list');
  const listCountEl = document.getElementById('project-count');
  const searchInput = document.getElementById('project-search');
  const topicSelect = document.getElementById('filter-topic');
  const stateSelect = document.getElementById('filter-state');
  const institutionSelect = document.getElementById('filter-institution');

  document.getElementById('detail-close').addEventListener('click', () => {
    clearDetail();
    selectProject(null);
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.role === currentRole) return;
      setActiveRole(btn.dataset.role);
    });
  });

  searchInput.addEventListener('input', () => {
    filters.search = searchInput.value.trim().toLowerCase();
    renderProjectList();
  });
  topicSelect.addEventListener('change', () => {
    filters.topic = topicSelect.value;
    renderProjectList();
  });
  stateSelect.addEventListener('change', () => {
    filters.state = stateSelect.value;
    renderProjectList();
  });
  institutionSelect.addEventListener('change', () => {
    filters.institution = institutionSelect.value;
    renderProjectList();
  });

  Promise.all([
    fetch('data/institutions.json').then((r) => r.json()),
    fetch('data/projects.json').then((r) => r.json()),
  ]).then(([inst, proj]) => {
    institutions = inst;
    projects = proj;
    renderRole(currentRole, { fit: true });
  });

  function setActiveRole(role) {
    currentRole = role;
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      const active = btn.dataset.role === role;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.getElementById('legend-row-lbnl').classList.toggle('inactive', role === 'partner_led');
    document.getElementById('legend-row-partner').classList.toggle('inactive', role === 'lbnl_led');
    clearDetail();
    filters = { search: '', topic: '', state: '', institution: '' };
    searchInput.value = '';
    renderRole(role, { fit: true });
  }

  const ARC_BASE_STYLE = { weight: 1.6, opacity: 0.55 };
  const ARC_HOVER_STYLE = { weight: 3, opacity: 0.95 };
  const ARC_DIM_STYLE = { weight: 1.6, opacity: 0.12 };
  const ARC_HIT_STYLE = { weight: 14, opacity: 0 };
  const MARKER_DIM_OPACITY = 0.2;

  function deriveState(city) {
    if (!city) return null;
    const m = city.match(/,\s*([A-Za-z]{2})\)?\s*$/);
    return m ? m[1].toUpperCase() : null;
  }

  function renderRole(role, opts) {
    opts = opts || {};
    layerGroup.clearLayers();
    projectEntries = new Map();
    selectedProjectId = null;
    openTooltipMarkers = [];
    highlightStatesForKeys([]);

    const roleProjects = role === 'all' ? projects : projects.filter((p) => p.role === role);
    const usedInstitutionKeys = new Set();
    const markerBounds = [];
    const markersByKey = new Map();

    roleProjects.forEach((project) => {
      const leadKey = project.leadInstitution;
      const lead = institutions[leadKey];
      if (!lead) return;
      usedInstitutionKeys.add(leadKey);

      const spokeKeys = project.partnerInstitutions.filter((k) => k !== leadKey);
      const projectArcs = [];
      const projectHitArcs = [];
      spokeKeys.forEach((spokeKey) => {
        const spoke = institutions[spokeKey];
        if (!spoke) return;
        usedInstitutionKeys.add(spokeKey);
        const { visible, hit } = drawArc(lead, spoke, ROLE_COLORS[project.role]);
        projectArcs.push(visible);
        projectHitArcs.push(hit);
      });
      projectEntries.set(project.id, {
        project,
        arcs: projectArcs,
        hitArcs: projectHitArcs,
        institutionKeys: [leadKey, ...spokeKeys],
      });
    });

    usedInstitutionKeys.forEach((key) => {
      const inst = institutions[key];
      if (!inst) return;
      markersByKey.set(key, drawInstitutionMarker(key, inst));
      markerBounds.push([inst.lat, inst.lon]);
    });

    const allArcs = Array.from(projectEntries.values()).flatMap((p) => p.arcs);
    const allMarkers = Array.from(markersByKey.values());

    projectEntries.forEach((entry) => {
      const { project, arcs, hitArcs, institutionKeys } = entry;
      const projectMarkers = institutionKeys.map((k) => markersByKey.get(k)).filter(Boolean);

      const applyEmphasis = () => {
        allArcs.forEach((a) => a.setStyle(arcs.includes(a) ? ARC_HOVER_STYLE : ARC_DIM_STYLE));
        allMarkers.forEach((m) => {
          const on = projectMarkers.includes(m);
          m.setStyle({ opacity: on ? 1 : MARKER_DIM_OPACITY, fillOpacity: on ? 1 : MARKER_DIM_OPACITY });
        });
      };
      // Click/selection: emphasize the arc AND open its endpoint tooltips.
      entry.highlight = () => {
        applyEmphasis();
        layoutTooltips(projectMarkers);
        highlightStatesForKeys(institutionKeys);
      };
      // Hover preview: emphasize the arc only, leaving tooltips as-is so a hover
      // never stacks its own tooltips on top of whatever is currently selected.
      entry.preview = () => {
        applyEmphasis();
      };
      entry.reset = () => {
        if (selectedProjectId) {
          projectEntries.get(selectedProjectId).highlight();
          return;
        }
        allArcs.forEach((a) => a.setStyle(ARC_BASE_STYLE));
        allMarkers.forEach((m) => m.setStyle({ opacity: 1, fillOpacity: 1 }));
        allMarkers.forEach((m) => m.closeTooltip());
        openTooltipMarkers = [];
        highlightStatesForKeys([]);
      };

      hitArcs.forEach((hitArc) => {
        hitArc.on('mouseover', entry.preview);
        hitArc.on('mouseout', entry.reset);
        hitArc.on('click', () => {
          showDetail(project);
          selectProject(project.id);
        });
      });
    });

    populateFilterOptions(roleProjects);
    renderProjectList();

    if (opts.fit && markerBounds.length) {
      map.fitBounds(markerBounds, { padding: [60, 60], maxZoom: 5 });
    }
  }

  function fitToProject(institutionKeys) {
    const coords = (institutionKeys || [])
      .map((key) => institutions[key])
      .filter(Boolean)
      .map((inst) => [inst.lat, inst.lon]);
    if (!coords.length) return;
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 6, animate: true });
  }

  function selectProject(projectId) {
    selectedProjectId = projectId;
    if (projectId && projectEntries.has(projectId)) {
      const entry = projectEntries.get(projectId);
      entry.highlight();
      fitToProject(entry.institutionKeys);
    } else {
      const anyEntry = projectEntries.values().next().value;
      if (anyEntry) anyEntry.reset();
    }
    document.querySelectorAll('.project-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.projectId === projectId);
    });
  }

  function populateFilterOptions(roleProjects) {
    const topics = Array.from(new Set(roleProjects.map((p) => p.topic))).sort();
    const stateSet = new Set();
    const institutionMap = new Map(); // key -> name

    roleProjects.forEach((project) => {
      [project.leadInstitution, ...project.partnerInstitutions].forEach((key) => {
        const inst = institutions[key];
        if (!inst) return;
        const state = deriveState(inst.city);
        if (state) stateSet.add(state);
        institutionMap.set(key, inst.name);
      });
    });

    const states = Array.from(stateSet).sort();
    const institutionOptions = Array.from(institutionMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));

    fillSelect(topicSelect, topics.map((t) => ({ value: t, label: t })), filters.topic);
    fillSelect(stateSelect, states.map((s) => ({ value: s, label: s })), filters.state);
    fillSelect(institutionSelect, institutionOptions.map(([value, label]) => ({ value, label })), filters.institution);
  }

  function fillSelect(select, options, currentValue) {
    const placeholder = select.options[0];
    select.innerHTML = '';
    select.appendChild(placeholder);
    options.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
    const stillValid = options.some((o) => o.value === currentValue);
    select.value = stillValid ? currentValue : '';
    if (!stillValid) {
      if (select === topicSelect) filters.topic = '';
      if (select === stateSelect) filters.state = '';
      if (select === institutionSelect) filters.institution = '';
    }
  }

  function projectMatchesFilters(project) {
    if (filters.topic && project.topic !== filters.topic) return false;
    if (filters.institution) {
      const keys = [project.leadInstitution, ...project.partnerInstitutions];
      if (!keys.includes(filters.institution)) return false;
    }
    if (filters.state) {
      const keys = [project.leadInstitution, ...project.partnerInstitutions];
      const matchesState = keys.some((k) => institutions[k] && deriveState(institutions[k].city) === filters.state);
      if (!matchesState) return false;
    }
    if (filters.search) {
      const lead = institutions[project.leadInstitution];
      const names = [project.title, lead ? lead.name : '', ...project.partnerInstitutions.map((k) => (institutions[k] ? institutions[k].name : ''))]
        .join(' ')
        .toLowerCase();
      if (!names.includes(filters.search)) return false;
    }
    return true;
  }

  function renderProjectList() {
    const roleProjects = Array.from(projectEntries.values()).map((e) => e.project);
    const filtered = roleProjects.filter(projectMatchesFilters).sort((a, b) => a.title.localeCompare(b.title));

    listPanel.innerHTML = '';
    listCountEl.textContent = `${filtered.length} of ${roleProjects.length} projects`;

    if (!filtered.length) {
      const li = document.createElement('li');
      li.id = 'project-list-empty';
      li.textContent = 'No projects match these filters.';
      listPanel.appendChild(li);
      return;
    }

    filtered.forEach((project) => {
      const lead = institutions[project.leadInstitution];
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'project-item';
      btn.dataset.projectId = project.id;
      btn.classList.toggle('active', project.id === selectedProjectId);
      btn.innerHTML = `
        <span class="project-item-role ${project.role}">${ROLE_LABELS[project.role]}</span>
        <span class="project-item-title">${project.title}</span>
        <span class="project-item-meta">${lead ? lead.name : project.leadInstitution} · ${project.topic}</span>
      `;
      btn.addEventListener('click', () => {
        if (selectedProjectId === project.id) {
          selectProject(null);
          clearDetail();
          return;
        }
        showDetail(project);
        selectProject(project.id);
      });
      li.appendChild(btn);
      listPanel.appendChild(li);
    });
  }

  function drawArc(fromInst, toInst, color) {
    const latlngs = arcPoints([fromInst.lat, fromInst.lon], [toInst.lat, toInst.lon]);
    const visible = L.polyline(latlngs, {
      pane: 'arcPane',
      color: color,
      smoothFactor: 1,
      ...ARC_BASE_STYLE,
    }).addTo(layerGroup);
    const hit = L.polyline(latlngs, {
      pane: 'arcPane',
      color: color,
      smoothFactor: 1,
      ...ARC_HIT_STYLE,
    }).addTo(layerGroup);
    return { visible, hit };
  }

  function drawInstitutionMarker(key, inst) {
    const isLBNL = key === LBNL_KEY;
    const marker = L.circleMarker([inst.lat, inst.lon], {
      pane: 'markerPane2',
      radius: isLBNL ? 9 : 5.5,
      color: isLBNL ? '#003262' : '#ffffff',
      weight: isLBNL ? 2 : 1.4,
      fillColor: isLBNL ? '#EAAA00' : '#6b7280',
      fillOpacity: 1,
    }).addTo(layerGroup);
    marker._tooltipHtml = `${inst.name}<br><span class="tooltip-muted">${inst.city}</span>`;
    marker._tooltipLayout = 0;
    marker.bindTooltip(marker._tooltipHtml, {
      ...TOOLTIP_LAYOUTS[0],
      className: 'institution-tooltip',
    });
    return marker;
  }

  // Opens tooltips for the given markers, nudging any that sit close together on
  // screen to alternate sides so their labels don't stack on top of each other.
  function layoutTooltips(markers) {
    openTooltipMarkers.forEach((m) => {
      if (!markers.includes(m)) m.closeTooltip();
    });
    openTooltipMarkers = markers;
    const points = markers.map((m) => map.latLngToContainerPoint(m.getLatLng()));
    const layoutIndex = markers.map(() => 0);

    for (let i = 0; i < markers.length; i++) {
      for (let j = i + 1; j < markers.length; j++) {
        if (layoutIndex[i] !== layoutIndex[j]) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < TOOLTIP_COLLISION_PX) {
          layoutIndex[j] = (layoutIndex[i] + 1) % TOOLTIP_LAYOUTS.length;
        }
      }
    }

    markers.forEach((marker, i) => {
      if (marker._tooltipLayout !== layoutIndex[i]) {
        marker._tooltipLayout = layoutIndex[i];
        marker.unbindTooltip();
        marker.bindTooltip(marker._tooltipHtml, {
          ...TOOLTIP_LAYOUTS[layoutIndex[i]],
          className: 'institution-tooltip',
        });
      }
      marker.openTooltip();
    });
  }

  function showDetail(project) {
    const lead = institutions[project.leadInstitution];
    const partnerKeys = project.partnerInstitutions.filter((k) => k !== project.leadInstitution);

    document.getElementById('detail-role').textContent = ROLE_LABELS[project.role];
    document.getElementById('detail-role').style.color = ROLE_COLORS[project.role];
    document.getElementById('detail-title').textContent = project.title;
    document.getElementById('detail-description').textContent = project.description;
    document.getElementById('detail-lead').textContent = lead ? `${lead.name} (${lead.city})` : project.leadInstitution;

    const list = document.getElementById('detail-partners');
    list.innerHTML = '';
    partnerKeys.forEach((key) => {
      const inst = institutions[key];
      const li = document.createElement('li');
      li.textContent = inst ? `${inst.name} (${inst.city})` : key;
      list.appendChild(li);
    });

    const sourceLink = document.getElementById('detail-source');
    if (project.sourceUrl) {
      sourceLink.href = project.sourceUrl;
      sourceLink.hidden = false;
    } else {
      sourceLink.hidden = true;
    }

    detailEmpty.hidden = true;
    detailContent.hidden = false;
    detailPanel.classList.remove('empty');
    detailPanel.hidden = false;
    map.invalidateSize({ pan: false });
  }

  function clearDetail() {
    detailEmpty.hidden = false;
    detailContent.hidden = true;
    detailPanel.classList.add('empty');
    detailPanel.hidden = true;
    map.invalidateSize({ pan: false });
  }

  function arcPoints(latlng1, latlng2, segments) {
    segments = segments || 64;
    const [lat1, lng1] = latlng1;
    const [lat2, lng2] = latlng2;
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng) || 0.0001;
    const perpLat = dLng / dist;
    const perpLng = -dLat / dist;
    const curvature = 0.18;
    const offset = dist * curvature;
    const controlLat = midLat + perpLat * offset;
    const controlLng = midLng + perpLng * offset;

    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      const lat = mt * mt * lat1 + 2 * mt * t * controlLat + t * t * lat2;
      const lng = mt * mt * lng1 + 2 * mt * t * controlLng + t * t * lng2;
      points.push([lat, lng]);
    }
    return points;
  }
})();
