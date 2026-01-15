// URL fija dentro del código (como pediste)
    let APP_CONFIG = {
      financeDataEndpoint: "https://script.google.com/macros/s/AKfycbwmlnws66Fz008rDTX9nWmvUEd6akvfT7e_ejgT85MGDAzx3c8iWNjHj05nS2W0qB8_cw/exec",
      reservationsApiBase: "https://checkinndashboard-1044570371371.northamerica-south1.run.app",
      reservationsEndpoint: "/api/reservations",
      timeoutMs: 15000
    };

    async function loadConfig(){
      try{
        const res = await fetch("./config.json", {cache:"no-store"});
        if(res.ok){
          const cfg = await res.json();
          APP_CONFIG = {...APP_CONFIG, ...cfg};
        }
      }catch(e){}
      window.DATA_ENDPOINT = APP_CONFIG.financeDataEndpoint;
    }
// Parámetro editable (menú): Esperado mensual total para KPIs de Ingresos
    const EXPECTED_INCOME_KEY = 'expected_income_monthly_total_v1';
    let EXPECTED_INCOME_MONTHLY = 700000; // default
    function loadExpectedIncomeParam(){
      try{
        const saved = localStorage.getItem(EXPECTED_INCOME_KEY);
        if(saved !== null && saved !== undefined && saved !== ''){
          const v = Number(saved);
          if(isFinite(v) && v >= 0) EXPECTED_INCOME_MONTHLY = v;
        }
      }catch(e){}
      const inp = document.getElementById('expectedIncome');
      if(inp){
        inp.value = String(EXPECTED_INCOME_MONTHLY);
        inp.addEventListener('input', ()=>{
          const v = Number(inp.value);
          if(isFinite(v) && v >= 0){
            EXPECTED_INCOME_MONTHLY = v;
            try{ localStorage.setItem(EXPECTED_INCOME_KEY, String(v)); }catch(e){}
            render();
          }
        });
      }
    }

    let RAW = [];
    let BUDGET = [];

    // Reservas (Cloud Run)
    let RES_RAW = [];
    let RES_LAST_Q = "";
    let SELECTED_KEY = null;
    let SELECTED_SRC = null;
    let CURRENT_VIEW = 'detalle';

    // FIX: deshabilitar vista de alertas dentro de la ventana de Detalles (usar pestaña principal)
    function disableRightAlertas(){
      CURRENT_VIEW = 'detalle';
      const detEl = document.getElementById('rightDetalle');
      const alEl  = document.getElementById('rightAlertas');
      if(detEl) detEl.classList.remove('hide');
      if(alEl) alEl.classList.add('hide');
      const detTab = document.getElementById('rtDet');
      const alTab  = document.getElementById('rtAl');
      if(detTab){ detTab.classList.add('active'); detTab.setAttribute('aria-selected','true'); }
      if(alTab){ alTab.classList.remove('active'); alTab.setAttribute('aria-selected','false'); }
    }


    const $ = (id)=>document.getElementById(id);
    const fmtMoney = (x)=> (Number(x||0)).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
    const fmtPct = (x)=> isFinite(x) ? (x*100).toFixed(1)+'%' : '—';
    const norm = (s)=> String(s??'').trim();
    const canon = (s)=> norm(s)
      .toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/\s+/g,' ')
      .trim()
      .toLowerCase();

    function yearFromMes(mes){
      const m = String(mes||"").match(/(\d{4})\s*$/);
      return m ? m[1] : "";
    }
    function recYear(r){
      // Prefer explicit Año in dataset; fallback to parse from Mes
      const y = norm(r?.Año ?? r?.ANO ?? r?.ANIO ?? "");
      return y || yearFromMes(r?.Mes);
    }
    function selectedYearFallback(){
      // If user selected one or more years, take the max. If none, take last year in data.
      const ys = [...FILTER_STATE["Año"]].filter(Boolean);
      if(ys.length) return ys.sort((a,b)=>b.localeCompare(a,'es'))[0];
      const all = getAllValuesForFilter("Año");
      return all.length ? all.sort((a,b)=>b.localeCompare(a,'es'))[0] : "";
    }

    function sevOver(av){
      if(!isFinite(av)) return {label:'—', cls:'pill'};
      if(av<=1.0) return {label:'OK', cls:'pill good'};
      if(av<=1.10) return {label:'Alerta', cls:'pill warn'};
      return {label:'Crítico', cls:'pill bad'};
    }
    function sevUnder(av){
      if(!isFinite(av)) return {label:'—', cls:'pill'};
      if(av>=1.0) return {label:'OK', cls:'pill good'};
      if(av>=0.90) return {label:'Alerta', cls:'pill warn'};
      return {label:'Crítico', cls:'pill bad'};
    }
    function pbarClassOver(av){
      if(!isFinite(av)) return 'pbar';
      if(av<=1.0) return 'pbar good';
      if(av<=1.10) return 'pbar warn';
      return 'pbar bad';
    }
    function pbarClassUnder(av){
      if(!isFinite(av)) return 'pbar';
      if(av>=1.0) return 'pbar good';
      if(av>=0.90) return 'pbar warn';
      return 'pbar bad';
    }

    const FILTER_STATE = {
      "Año": new Set(),
      Mes: new Set(),
      CATEGORIA: new Set(),
      CONCEPTO: new Set(),
      "Cuenta bancaria": new Set()
    };

    // Filtros para Reservas (Cloud Run)
    const RES_FILTER_STATE = {
      "Año": new Set(),           // se sincroniza con el Año financiero (si hay 1 seleccionado)
      "Alojamiento": new Set(),   // multi
      "Tipo reserva": new Set()   // multi
    };


    const PANEL_RENDER = {}; // permite re-render de paneles (Mes es esclavo de Año)

    function tipoVal(){
      const id = document.querySelector('.tab.active')?.id;
      if(id==='tabI') return 'I';
      if(id==='tabA') return 'A';
      if(id==='tabR') return 'R';
      return 'E';
    }
    function setTipo(v){
      document.getElementById('tabE').classList.toggle('active', v==='E');
      document.getElementById('tabI').classList.toggle('active', v==='I');
      document.getElementById('tabA').classList.toggle('active', v==='A');
      document.getElementById('tabR').classList.toggle('active', v==='R');
      document.getElementById('tabE').setAttribute('aria-selected', v==='E'?'true':'false');
      document.getElementById('tabI').setAttribute('aria-selected', v==='I'?'true':'false');
      document.getElementById('tabA').setAttribute('aria-selected', v==='A'?'true':'false');
      document.getElementById('tabR').setAttribute('aria-selected', v==='R'?'true':'false');

      SELECTED_KEY = null;
      SELECTED_SRC = null;
      setRightView('detalle');
      syncTipoUI();
      if(v==='R'){
        loadReservations(true).then(()=>{ try{ renderResFilterPanels(); }catch(e){}; render(); });
      }
      render();
    }



    async function loadLive(){
      try{
        $('status').innerHTML = '<span class="dot"></span>Cargando…';
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 15000);
        const res = await fetch(window.DATA_ENDPOINT, {cache:'no-store', signal: ctrl.signal});
        clearTimeout(t);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const payload = await res.json();
        RAW = payload.records || [];
        BUDGET = payload.budget || [];
        resetBudgetCache();
        $('status').innerHTML = '<span class="dot"></span>Online • ' + RAW.length.toLocaleString('es-MX') + ' movimientos';
        return true;
      }catch(e){
        console.warn('Fetch falló:', e);
        const msg = (e && e.name === 'AbortError') ? 'Timeout (15s)' : 'Error';
        $('status').innerHTML = '<span class="dot"></span>'+msg+' al actualizar (ver consola)';
        return false;
      }
    }


    // ------------------ Reservas: Cloud Run ------------------
    function selectedYearFallback(){
      const yrs = Array.from(FILTER_STATE["Año"]||[]);
      return (yrs.length===1) ? yrs[0] : "";
    }
    function resField(r, keys, fallback=""){
      for(const k of keys){
        if(r && r[k] !== undefined && r[k] !== null && String(r[k]).trim()!=="") return r[k];
      }
      return fallback;
    }
    function toDateSafe(x){
      const s = String(x||"").trim();
      if(!s) return null;
      const d = new Date(s);
      if(!isFinite(d.getTime())) return null;
      return d;
    }
    function nightsBetween(a,b){
      const da = toDateSafe(a); const db = toDateSafe(b);
      if(!da || !db) return null;
      const ms = db.getTime()-da.getTime();
      if(!isFinite(ms)) return null;
      const n = Math.round(ms/(1000*60*60*24));
      return (n>=0 && n<400) ? n : null;
    }
    function resYear(r){
      const d = toDateSafe(resField(r, ["checkIn","arrival","start","startDate","desde","fecha_inicio","fechaEntrada","FechaEntrada"]));
      if(d) return String(d.getFullYear());
      const y = String(resField(r, ["year","Año","ano","anio"], "")).trim();
      return y;
    }
    function resProp(r){
      return String(resField(r, ["propertyName","listingName","unitName","accommodation","alojamiento","propiedad","name"], "—")).trim() || "—";
    }
    function resType(r){
      return String(resField(r, ["bookingType","type","channel","source","origen","fuente","plataforma"], "—")).trim() || "—";
    }

    function buildResOptions(){
      const props = uniqSorted(RES_RAW.map(r=>resProp(r)).filter(x=>x && x!=="—"));
      const types = uniqSorted(RES_RAW.map(r=>resType(r)).filter(x=>x && x!=="—"));
      return {props, types};
    }

    function renderResFilterPanels(){
      const {props, types} = buildResOptions();

      const propWrap = document.getElementById('resProps');
      const typeWrap = document.getElementById('resTypes');

      if(propWrap){
        propWrap.innerHTML = '';
        props.forEach(v=>{
          const id = 'rp_' + canon(v).replace(/[^a-z0-9]+/g,'_');
          const lab = document.createElement('label');
          lab.className = 'opt';
          lab.innerHTML = `<input type="checkbox" id="${id}"> <span>${escHtml(v)}</span>`;
          const inp = lab.querySelector('input');
          inp.checked = RES_FILTER_STATE["Alojamiento"].size ? RES_FILTER_STATE["Alojamiento"].has(v) : true;
          inp.addEventListener('change', ()=>{
            if(!RES_FILTER_STATE["Alojamiento"].size){
              // si estaba "todos", primero inicializa con todos
              props.forEach(p=>RES_FILTER_STATE["Alojamiento"].add(p));
            }
            if(inp.checked) RES_FILTER_STATE["Alojamiento"].add(v);
            else RES_FILTER_STATE["Alojamiento"].delete(v);
            render();
          });
          propWrap.appendChild(lab);
        });
      }

      if(typeWrap){
        typeWrap.innerHTML = '';
        types.forEach(v=>{
          const id = 'rt_' + canon(v).replace(/[^a-z0-9]+/g,'_');
          const lab = document.createElement('label');
          lab.className = 'opt';
          lab.innerHTML = `<input type="checkbox" id="${id}"> <span>${escHtml(v)}</span>`;
          const inp = lab.querySelector('input');
          inp.checked = RES_FILTER_STATE["Tipo reserva"].size ? RES_FILTER_STATE["Tipo reserva"].has(v) : true;
          inp.addEventListener('change', ()=>{
            if(!RES_FILTER_STATE["Tipo reserva"].size){
              types.forEach(t=>RES_FILTER_STATE["Tipo reserva"].add(t));
            }
            if(inp.checked) RES_FILTER_STATE["Tipo reserva"].add(v);
            else RES_FILTER_STATE["Tipo reserva"].delete(v);
            render();
          });
          typeWrap.appendChild(lab);
        });
      }

      const pLbl = document.getElementById('resPropsLbl');
      if(pLbl){
        const sel = RES_FILTER_STATE["Alojamiento"].size;
        pLbl.textContent = sel ? `${sel} seleccionados` : `Todos (${props.length})`;
      }
      const tLbl = document.getElementById('resTypesLbl');
      if(tLbl){
        const sel = RES_FILTER_STATE["Tipo reserva"].size;
        tLbl.textContent = sel ? `${sel} seleccionados` : `Todos (${types.length})`;
      }
    }

    async function loadReservations(force=false){
      const year = selectedYearFallback();
      const propsSel = [...RES_FILTER_STATE["Alojamiento"]];
      const typesSel = [...RES_FILTER_STATE["Tipo reserva"]];
      const q = JSON.stringify({year, propsSel, typesSel});
      if(!force && RES_LAST_Q === q && RES_RAW.length) return true;

      try{
        const base = (APP_CONFIG.reservationsApiBase || "").replace(/\/$/,"");
        const ep = APP_CONFIG.reservationsEndpoint || "/api/reservations";
        const url = new URL(base + ep);
        if(year) url.searchParams.set("year", year);
        if(propsSel.length) url.searchParams.set("property", propsSel.join(","));
        if(typesSel.length) url.searchParams.set("type", typesSel.join(","));

        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), Number(APP_CONFIG.timeoutMs||15000));
        const res = await fetch(url.toString(), {cache:"no-store", signal: ctrl.signal});
        clearTimeout(t);
        if(!res.ok) throw new Error("HTTP "+res.status);

        const payload = await res.json();
        const arr = payload.reservations || payload.data || payload.items || payload.records || [];
        if(!Array.isArray(arr)) throw new Error("Formato inesperado en reservas");
        RES_RAW = arr;
        RES_LAST_Q = q;
        return true;
      }catch(e){
        console.warn("Reservas: fetch falló", e);
        return false;
      }
    }

    function filteredReservations(){
      const year = selectedYearFallback();
      const props = RES_FILTER_STATE["Alojamiento"];
      const types = RES_FILTER_STATE["Tipo reserva"];

      return RES_RAW.filter(r=>{
        const y = resYear(r);
        if(year && y && y !== year) return false;
        const p = resProp(r);
        const t = resType(r);
        if(props.size && p && !props.has(p)) return false;
        if(types.size && t && !types.has(t)) return false;
        return true;
      });
    }

    function aggregateReservations(){
      const recs = filteredReservations();
      const g = new Map();
      for(const r of recs){
        const prop = resProp(r);
        const typ  = resType(r);
        const amount = Number(resField(r, ["total","amount","importe","monto","price","totalAmount","revenue","payout"], 0)) || 0;
        const nights = Number(resField(r, ["nights","noches","nightCount"], "")) || nightsBetween(
          resField(r, ["checkIn","arrival","startDate","start","desde","fechaEntrada"]),
          resField(r, ["checkOut","departure","endDate","end","hasta","fechaSalida"])
        ) || 0;

        const key = prop + "||" + typ;
        if(!g.has(key)) g.set(key, {key, prop, typ, bookings:0, nights:0, amount:0});
        const o = g.get(key);
        o.bookings += 1;
        o.nights += (nights||0);
        o.amount += amount;
      }

      const rows = [...g.values()].sort((a,b)=> (b.amount-a.amount) || (b.bookings-a.bookings) || a.prop.localeCompare(b.prop,'es'));
      const totBookings = recs.length;
      const totNights = rows.reduce((a,r)=>a+r.nights,0);
      const totAmount = rows.reduce((a,r)=>a+r.amount,0);
      return {rows, totBookings, totNights, totAmount};
    }

    function renderReservationsDetails(rowKey){
      const tb = document.getElementById('tbD');
      tb.innerHTML = '';
      if(!rowKey){
        document.getElementById('selInfo').textContent = 'Sin selección.';
        return;
      }
      const [prop, typ] = rowKey.split('||');
      document.getElementById('selInfo').innerHTML = `<span class="pill">Reservas</span>
        <span style="color:var(--muted)"> ${escHtml(prop)} • ${escHtml(typ)}</span>`;

      const recs = filteredReservations().filter(r=>resProp(r)===prop && resType(r)===typ);

      for(const r of recs){
        const checkIn  = resField(r, ["checkIn","arrival","startDate","start","desde","fechaEntrada"], "");
        const checkOut = resField(r, ["checkOut","departure","endDate","end","hasta","fechaSalida"], "");
        const status   = String(resField(r, ["status","estado"], "")).trim();
        const amount   = Number(resField(r, ["total","amount","importe","monto","price","totalAmount"], 0)) || 0;
        const nights   = Number(resField(r, ["nights","noches","nightCount"], "")) || nightsBetween(checkIn, checkOut) || 0;
        const guest    = String(resField(r, ["guestName","guest","huesped","cliente"], "")).trim();
        const code     = String(resField(r, ["code","bookingCode","id","reservationId"], "")).trim();

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escHtml(String(checkIn||"—"))}</td>
          <td>${escHtml(String(checkOut||"—"))}</td>
          <td><span class="pill">${escHtml(status||typ)}</span></td>
          <td>${escHtml(prop)}</td>
          <td>${escHtml(guest || code || '—')}</td>
          <td>${escHtml("Noches: "+(nights||0))}</td>
          <td><span class="pill ${amount? 'good':'warn'}">${amount? 'OK':'—'}</span></td>
          <td class="num">${fmtMoney(amount)}</td>
        `;
        tb.appendChild(tr);
      }
    }

    function uniqSorted(arr){
      return [...new Set(arr.map(norm).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    }
    function getAllValuesForFilter(name){
      if(name==='Año') return uniqSorted(RAW.map(r=>recYear(r)).filter(Boolean));
      if(name==='Mes') return uniqSorted(RAW.map(r=>r.Mes));
      if(name==='CATEGORIA') return uniqSorted(RAW.map(r=>r.CATEGORIA));
      if(name==='CONCEPTO') return uniqSorted(RAW.map(r=>r.CONCEPTO));
      if(name==='Cuenta bancaria') return uniqSorted(RAW.map(r=>r['Cuenta bancaria']));
      return [];
    }

    function updateAllLabels(){
      const map = {'Año':'cAnoLbl',Mes:'cMesLbl',CATEGORIA:'cCatLbl',CONCEPTO:'cConLbl','Cuenta bancaria':'cCtaLbl'};
      for(const k in map){
        const all = getAllValuesForFilter(k);
        const sel = FILTER_STATE[k].size;
        let t = 'Todos';
        if(sel===0) t = 'Ninguno';
        else if(k==='Año' && sel===1){
          t = Array.from(FILTER_STATE['Año'])[0];
        }
        else if(sel===all.length) t = 'Todos ('+all.length+')';
        else t = sel + ' seleccionados';
        document.getElementById(map[k]).textContent = t;
      }
    }

    function refreshToggleButtons(){
      document.querySelectorAll('.comboPanel').forEach(panel=>{
        const filterName = panel.dataset.filter;
        const all = getAllValuesForFilter(filterName);
        const btn = panel.querySelector('.toggleAll');
        if(!btn) return;
        const isAll = FILTER_STATE[filterName].size === all.length && all.length>0;
        btn.classList.toggle('on', isAll);
      });
    }

    function initFilterPanels(){
      document.querySelectorAll('.comboPanel').forEach(panel=>{
        const filterName = panel.dataset.filter;
        const search = panel.querySelector('.comboTop input');
        const toggle = panel.querySelector('.toggleAll');
        const optsWrap = panel.querySelector('.opts');

        function renderOpts(){
          const allValues = getAllValuesForFilter(filterName);
          const q = norm(search.value).toLowerCase();
          optsWrap.innerHTML = '';
          for(const v of allValues){
            if(q && !v.toLowerCase().includes(q)) continue;
            const row = document.createElement('div');
            row.className = 'opt';
            const checked = FILTER_STATE[filterName].has(v);
            if(filterName==='Año'){
              row.innerHTML = `<input type="radio" name="yearRadio" ${checked?'checked':''} /> <span>${v}</span>`;
            } else {
              row.innerHTML = `<input type="checkbox" ${checked?'checked':''} /> <span>${v}</span>`;
            }
            row.addEventListener('click', (ev)=>{
              const cb = row.querySelector('input');
              if(ev.target !== cb) cb.checked = !cb.checked;

              if(filterName==='Año'){
                // selección única de Año
                FILTER_STATE['Año'] = new Set([v]);

                // Mes es esclavo: al cambiar Año, selecciona TODOS los meses de ese año
                const allMes = getAllValuesForFilter('Mes');
                const mesForYear = allMes.filter(m=>yearFromMes(m)===v);
                FILTER_STATE.Mes = new Set(mesForYear);

                // Re-render del panel Mes para reflejar la selección
                if(PANEL_RENDER['Mes']) PANEL_RENDER['Mes']();
              } else {
                if(cb.checked) FILTER_STATE[filterName].add(v);
                else FILTER_STATE[filterName].delete(v);
              }

              updateAllLabels();
              refreshToggleButtons();
              render();
            });
            optsWrap.appendChild(row);
          }
        }

        if(toggle) toggle.addEventListener('click', ()=>{
          const allValues = getAllValuesForFilter(filterName);
          const isAll = FILTER_STATE[filterName].size === allValues.length && allValues.length>0;
          FILTER_STATE[filterName] = isAll ? new Set() : new Set(allValues);
          updateAllLabels();
          refreshToggleButtons();
          renderOpts();
          render();
        });

        search.addEventListener('input', ()=> renderOpts());
        PANEL_RENDER[filterName] = renderOpts;
        renderOpts();
      });

      updateAllLabels();
      refreshToggleButtons();
    }

    function setDefaultAll(){
      // Default: último año disponible, y TODOS los meses de ese año.
      const years = getAllValuesForFilter('Año');
      const lastYear = years.length ? years.sort((a,b)=>b.localeCompare(a,'es'))[0] : '';
      FILTER_STATE['Año'] = lastYear ? new Set([lastYear]) : new Set(years);

      const allAno = getAllValuesForFilter('Año');
        const allMes = getAllValuesForFilter('Mes');
      const mesLastYear = lastYear ? allMes.filter(m=>yearFromMes(m)===lastYear) : allMes;
      FILTER_STATE.Mes = new Set(mesLastYear);

      ['CATEGORIA','CONCEPTO','Cuenta bancaria'].forEach(name=>{
        FILTER_STATE[name] = new Set(getAllValuesForFilter(name));
      });

      updateAllLabels();
      refreshToggleButtons();
    }

    
    // --- Presupuesto / Esperado (en PRESUPUESTO.Mensual) ---
    // En tu hoja PRESUPUESTO, "Mensual" significa:
    // - TIPO = Egresos  -> Presupuesto mensual
    // - TIPO = Ingresos -> Ingreso esperado mensual
    // En vez de depender de un match exacto, construimos un índice con 2 llaves:
    //  (1) canon() (sin acentos, minúsculas, espacios normalizados)
    //  (2) canonCompact() (además quita toda la puntuación)
    const BUDGET_INDEX_CACHE = { E:null, I:null };

    const canonCompact = (s)=> canon(s).replace(/[^a-z0-9]+/g,''); // quita todo excepto letras/números

    function buildBudgetIndex(tipo){
      // tipo: 'E' (egresos) o 'I' (ingresos)
      const m1 = new Map();
      const m2 = new Map();

      for(const b of (BUDGET||[])){
        const tipoRaw = b.TIPO ?? b.Tipo ?? b.CUENTA ?? b.Cuenta ?? '';
        const t = canon(tipoRaw);

        const isE = t.includes('egr') || t.includes('gasto') || t.includes('egreso');
        const isI = t.includes('ing') || t.includes('venta') || t.includes('ingreso');

        // Si viene TIPO (antes CUENTA), filtramos por Egresos/Ingresos. Si viene vacío, lo aceptamos (compatibilidad).
        if(t){
          if(tipo==='E' && !isE) continue;
          if(tipo==='I' && !isI) continue;
        }

        const cat = (b.CATEGORIA ?? b.Categoria ?? b['Categoría'] ?? '').toString();
        const con = (b.CONCEPTO  ?? b.Concepto  ?? b['Concepto']  ?? '').toString();
        const val = Number(b.MENSUAL ?? b.Mensual ?? 0) || 0;

        const k1 = canon(cat)+'||'+canon(con);
        const k2 = canonCompact(cat)+'||'+canonCompact(con);

        m1.set(k1, (m1.get(k1)||0) + val);
        m2.set(k2, (m2.get(k2)||0) + val);
      }

      return {m1, m2};
    }

    function ensureBudgetIndex(tipo){
      if(!BUDGET_INDEX_CACHE[tipo]) BUDGET_INDEX_CACHE[tipo] = buildBudgetIndex(tipo);
      return BUDGET_INDEX_CACHE[tipo];
    }

    function getBudgetMensual(tipo, categoria, concepto){
      // tipo: 'E' (egresos) o 'I' (ingresos)
      // Buscamos por Categoria+Concepto. Si no se encuentra para Ingresos, aplicamos fallback a Egresos
      // (útil cuando en PRESUPUESTO el TIPO viene distinto a lo esperado).
      const idx = ensureBudgetIndex(tipo);
      const k1 = canon(categoria)+'||'+canon(concepto);
      const k2 = canonCompact(categoria)+'||'+canonCompact(concepto);

      let v = 0;

      // Intento 1: canon normal
      if(idx.m1.has(k1)) v = Number(idx.m1.get(k1)||0);
      // Intento 2: canon sin puntuación
      else if(idx.m2.has(k2)) v = Number(idx.m2.get(k2)||0);

      // Fallback: si es Ingresos y no se encontró, intenta en Egresos
      if((!v || v===0) && tipo==='I'){
        const idxE = ensureBudgetIndex('E');
        if(idxE.m1.has(k1)) v = Number(idxE.m1.get(k1)||0);
        else if(idxE.m2.has(k2)) v = Number(idxE.m2.get(k2)||0);
      }
      return v || 0;
    }

    function resetBudgetCache(){
      BUDGET_INDEX_CACHE.E = null;
      BUDGET_INDEX_CACHE.I = null;
    }


    function filteredRecords(tipo, ignoreMes=false, forcedYear=""){
      const q = norm(document.getElementById('q').value).toLowerCase();
      return RAW.filter(r=>{
        const Mes = norm(r.Mes);
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const Cta = norm(r['Cuenta bancaria']||'');
        const y = recYear(r) || yearFromMes(Mes);
        const Tipo = norm(r.TIPO||'').toLowerCase();

        const ok =
          (FILTER_STATE['Año'].size ? FILTER_STATE['Año'].has(y) : true) &&
          (ignoreMes ? true : FILTER_STATE.Mes.has(Mes)) &&
          FILTER_STATE.CATEGORIA.has(Cat) &&
          FILTER_STATE.CONCEPTO.has(Con) &&
          FILTER_STATE["Cuenta bancaria"].has(Cta) &&
          (!forcedYear || y === forcedYear) &&
          (tipo==='E' ? Tipo.includes('egr') : Tipo.includes('ing'));

        if(!ok) return false;
        if(!q) return true;
        return (Cat+' '+Con+' '+Cta).toLowerCase().includes(q);
      });
    }

    function aggregate(tipo){
      ensureBudgetIndex(tipo);
      const recs = filteredRecords(tipo, false);

      const g = new Map();
      for(const r of recs){
        const Mes = norm(r.Mes);
        const Cta = norm(r['Cuenta bancaria']||'');
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const CatK = canon(Cat);
        const ConK = canon(Con);
        const key = [Cat,Con,Mes].join('||');

        const bud = getBudgetMensual(tipo, Cat, Con);
        const monto = Number(r.Monto||0);

        if(!g.has(key)) g.set(key,{key,Cat,Con,Mes,Cta:'',Real:0,Bud:bud});
        g.get(key).Real += monto;
      }

      const rows = [...g.values()].map(r=>{
        const realAbs = Math.abs(r.Real);
        const budAbs = Math.abs(Number(r.Bud||0));
        const av = budAbs>0 ? (realAbs / budAbs) : NaN;
        const sev = (tipo==='E') ? sevOver(av) : sevUnder(av);
        return {...r, RealAbs:realAbs, BudAbs:budAbs, Av:av, Sev:sev};
      });

      rows.sort((a,b)=>{
        const c = a.Cat.localeCompare(b.Cat,'es'); if(c!==0) return c;
        const d = (a.Con||'').localeCompare(b.Con||'','es'); if(d!==0) return d;
        const e = (a.Mes||'').localeCompare(b.Mes||'','es'); if(e!==0) return e;
        return (a.Cta||'').localeCompare(b.Cta||'','es');
      });

      const realM = recs.reduce((a,r)=>a+Math.abs(Number(r.Monto||0)),0);

      // Presupuesto/Esperado mensual: sumar UNA vez por partida por mes (evita duplicar por múltiples movimientos)
      const seenMB = new Set();
      let budM = 0;
      for(const r of recs){
        const Mes = norm(r.Mes);
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const CatK = canon(Cat);
        const ConK = canon(Con);
        const k = CatK+'||'+ConK+'||'+Mes;
        if(seenMB.has(k)) continue;
        seenMB.add(k);
        budM += Math.abs(getBudgetMensual(tipo, Cat, Con));
      }
      const avM = budM>0 ? (realM/budM) : NaN;

      const year = selectedYearFallback();
      const recsYear = filteredRecords(tipo, true, year);
      const realY = recsYear.reduce((a,r)=>a+Math.abs(Number(r.Monto||0)),0);

      const seenY = new Set();
      let budY = 0;
      for(const r of recsYear){
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const k = canon(Cat)+'||'+canon(Con);
        if(seenY.has(k)) continue;
        seenY.add(k);
        budY += Math.abs(getBudgetMensual(tipo, Cat, Con)) * 12;
      }
      const avY = budY>0 ? (realY/budY) : NaN;

      // alerts count (solo Egresos)
      const alerts = (tipo==='E') ? rows.filter(r=> r.BudAbs>0 && r.Av>1.0).length : 0;

      return {rows, realM, budM, avM, alerts, year, realY, budY, avY};
    }

    function setRightView(view){
      CURRENT_VIEW = view;
      const isDet = view === 'detalle';

      document.getElementById('rightDetalle').classList.toggle('hide', !isDet);
      document.getElementById('rightAlertas').classList.toggle('hide', isDet);

      // Tabs state
      const detTab = document.getElementById('rtDet');
      const alTab  = document.getElementById('rtAl');
      if(detTab && alTab){
        detTab.classList.toggle('active', isDet);
        alTab.classList.toggle('active', !isDet);
        detTab.setAttribute('aria-selected', isDet?'true':'false');
        alTab.setAttribute('aria-selected', !isDet?'true':'false');
      }

      // Title/Subtitle remain as "Detalle (drilldown)" (ventana única con tabs)
      document.getElementById('rightTitle').textContent = 'Detalle (drilldown)';
      document.getElementById('rightSub').textContent = isDet
        ? 'Selecciona un renglón para ver los movimientos que lo componen.'
        : 'Listado de partidas con alerta. Click para abrir su detalle.';

      document.getElementById('viewPill').textContent = 'Vista: ' + (isDet ? 'Detalle' : 'Alertas');
    }

    function syncTipoUI(){
      const tipo = tipoVal();
      const tipoLabel = (tipo==='E') ? 'Egresos' : (tipo==='I') ? 'Ingresos' : 'Alertas';
      document.getElementById('tipoPill').textContent = 'Tipo: ' + tipoLabel;

      if(tipo==='A'){
        
        document.getElementById('mainTableTitle').textContent = 'Alertas (partidas fuera de umbral)';
        document.getElementById('mainTableSub').textContent = 'Selecciona una alerta para ver el detalle de la partida.';
      } else {
        document.getElementById('mainTableTitle').textContent = (tipo==='E')
          ? 'Egresos (Presupuesto vs Real)'
          : 'Ingresos (Esperado vs Real)';
        document.getElementById('mainTableSub').textContent = (tipo==='E')
          ? 'Real y presupuesto en positivo (valor absoluto).'
          : 'Alerta si el real es menor al esperado (<100%).';
      }

      // header
      const tr = document.getElementById('theadRow'); tr.innerHTML = '';
      let cols;
      if(tipo==='E'){
        cols = ['Categoría','Concepto','Mes','Real','Presupuesto','Avance','Alerta'];
      } else if(tipo==='I'){
        cols = ['Categoría','Concepto','Mes','Real'];
      } else {
        cols = ['Tipo','Categoría','Concepto','Mes','%','Severidad'];
      }
      const numeric = new Set(['Real','Presupuesto','%']);
      cols.forEach(c=>{
        const th = document.createElement('th');
        th.textContent = c;
        if(numeric.has(c)) th.className='num';
        tr.appendChild(th);
      });
    }

    function renderDetails(selectedKey, source){
      const tb = document.getElementById('tbD'); tb.innerHTML = '';
      if(!selectedKey){ document.getElementById('selInfo').textContent = 'Sin selección.'; return; }

      // Si estamos en pestaña Alertas, determina si la partida es Egreso o Ingreso
      if(source==='A'){
        if(SELECTED_SRC==='E' || SELECTED_SRC==='I'){
          source = SELECTED_SRC;
        } else {
          // Inferencia: busca cualquier registro que coincida y decide por TIPO
          const partsTmp = selectedKey.split('||');
          const CatTmp = partsTmp[0] || '';
          const ConTmp = partsTmp[1] || '';
          const MesTmp = partsTmp[2] || '';
          const probe = RAW.find(r=> norm(r.CATEGORIA)===CatTmp && norm(r.CONCEPTO)===ConTmp && norm(r.Mes)===MesTmp);
          const t = (probe && probe.TIPO) ? norm(probe.TIPO).toLowerCase() : '';
          source = t.includes('ing') ? 'I' : 'E';
        }
      }


      const parts = selectedKey.split('||');
      const Cat = parts[0] || '';
      const Con = parts[1] || '';
      const Mes = parts[2] || '';
      const Cta = '';
      document.getElementById('selInfo').innerHTML = `<span class="pill">${source==='E'?'Egreso':'Ingreso'}</span>
        <span style="color:var(--muted)"> ${Cat} → ${Con||'(sin concepto)'} • ${Mes}</span>`;

      const rows = RAW.filter(r=>{
        const Mes2=norm(r.Mes), Cta2=norm(r['Cuenta bancaria']||''), Tipo2=norm(r.TIPO||'').toLowerCase();
        const Cat2=norm(r.CATEGORIA), Con2=norm(r.CONCEPTO);
        const same = Cat2===Cat && Con2===Con && Mes2===Mes;
        if(!same) return false;
        const okCta = FILTER_STATE['Cuenta bancaria'] ? FILTER_STATE['Cuenta bancaria'].has(Cta2) : true;
        if(!okCta) return false;
        return (source==='E') ? Tipo2.includes('egr') : Tipo2.includes('ing');
      });

      for(const r of rows){
        const facturaTxt = norm(r.Factura || '');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${norm(r.Mes)}</td>
          <td>${norm(r['Cuenta bancaria']||'')}</td>
          <td><span class="pill">${norm(r.TIPO||'')}</span></td>
          <td>${norm(r.CATEGORIA)}</td>
          <td>${norm(r.CONCEPTO) || '(sin concepto)'}</td>
          <td>${norm(r.DESCRIPCION || r.Descripcion || r.DESCRIPCIÓN || '')}</td>
          <td><span class="pill ${facturaTxt ? 'good':'warn'}">${facturaTxt ? facturaTxt : 'Sin factura'}</span></td>
          <td class="num">${fmtMoney(Number(r.Monto||0))}</td>
        `;
        tb.appendChild(tr);
      }
    }

    function renderAlertsList(rows, source){
      setRightView('alertas');
      const tb = document.getElementById('tbA'); tb.innerHTML = '';
      document.getElementById('alertInfo').innerHTML = source==='E'
        ? `<span class="pill bad">Egresos</span> <span style="color:var(--muted)">Partidas > 100% del presupuesto</span>`
        : `<span class="pill bad">Ingresos</span> <span style="color:var(--muted)">Partidas < 100% del esperado</span>`;

      const sorted = rows.slice().sort((a,b)=> source==='E' ? (b.Av-a.Av) : (a.Av-b.Av));
      for(const r of sorted){
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
          <td><span class="pill">${source==='E'?'Egreso':'Ingreso'}</span></td>
          <td>${r.Cat}</td>
          <td>${r.Con || '(sin concepto)'}</td>
          <td>${r.Mes}</td>
          <td class="num">${isFinite(r.Av)?fmtPct(r.Av):'—'}</td>
          <td><span class="${r.Sev.cls}">${r.Sev.label}</span></td>
        `;
        tr.addEventListener('click', ()=>{
          setTipo(source);
          SELECTED_KEY = r.key;
          setRightView('detalle');
          render();
          const target = document.querySelector(`#tbMain tr[data-key="${CSS.escape(r.key)}"]`);
          if(target) target.classList.add('selected');
        });
        tb.appendChild(tr);
      }
    }

    function setBar(elId, av, type){
      const el = document.getElementById(elId);
      const pct = isFinite(av) ? Math.min(Math.max(av,0), 2.0) : 0;
      el.className = (type==='E') ? pbarClassOver(av) : pbarClassUnder(av);
      el.querySelector('i').style.width = (pct*100).toFixed(1) + '%';
    }

    // --- MÓDULO: Indicadores financieros (seguro) ---
    function monthOrderKey(m){
      const s = String(m||'');
      const mm = s.match(/^\s*(\d{1,2})\s*[.\-\/]/);
      if(mm) return Number(mm[1]);
      const map = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
      const c = canon(s).split(' ')[0];
      if(map[c]) return map[c];
      return 99;
    }

    function computeMonthlySeriesForYear(yearSel){
      const eRecs = filteredRecords('E', true, yearSel);
      const iRecs = filteredRecords('I', true, yearSel);

      const sumByMes = (recs)=>{
        const m = new Map();
        for(const r of recs){
          const Mes = norm(r.Mes);
          m.set(Mes, (m.get(Mes)||0) + Math.abs(Number(r.Monto||0)));
        }
        return m;
      };
      const mE = sumByMes(eRecs);
      const mI = sumByMes(iRecs);

      const months = [...new Set([...mE.keys(), ...mI.keys()])];
      months.sort((a,b)=>{
        const ya = yearFromMes(a), yb = yearFromMes(b);
        if(ya!==yb) return ya.localeCompare(yb,'es');
        const ka = monthOrderKey(a), kb = monthOrderKey(b);
        if(ka!==kb) return ka-kb;
        return a.localeCompare(b,'es');
      });

      const rows = months.map(m=>{
        const I = mI.get(m)||0;
        const E = mE.get(m)||0;
        const U = I - E;
        const M = I>0 ? (U/I) : NaN;
        return {Mes:m, I, E, U, M};
      });

      const ytdI = rows.reduce((a,r)=>a+r.I,0);
      const ytdE = rows.reduce((a,r)=>a+r.E,0);
      const ytdU = ytdI - ytdE;
      const ytdM = ytdI>0 ? (ytdU/ytdI) : NaN;

      const nMonths = rows.filter(r=> (r.I>0 || r.E>0)).length || 0;
      const avgI = nMonths? (ytdI/nMonths) : 0;
      const avgE = nMonths? (ytdE/nMonths) : 0;
      const avgU = nMonths? (ytdU/nMonths) : 0;

      return {yearSel, rows, ytdI, ytdE, ytdU, ytdM, nMonths, avgI, avgE, avgU};
    }

    function svgLine3(series){
      const rows = series.rows || [];
      const W=560, H=250, padL=52, padR=16, padT=18, padB=44;
      const plotW=W-padL-padR, plotH=H-padT-padB;

      if(!rows.length){
        return `<div class="small" style="color:var(--muted)">Sin datos para graficar.</div>`;
      }

      const maxV = Math.max(1, ...rows.map(r=>Math.max(r.I,r.E, Math.abs(r.U))));
      const x = (i)=> padL + (rows.length===1 ? plotW/2 : (i*(plotW/(rows.length-1))));
      const y = (v)=> padT + (1 - (v/maxV))*plotH;

      const pathPos = (key)=>{
        return rows.map((r,i)=>`${i===0?'M':'L'} ${x(i).toFixed(2)} ${y(Math.max(0, r[key])).toFixed(2)}`).join(' ');
      };

      const pI = pathPos('I');
      const pE = pathPos('E');
      const pU = pathPos('U');

      const labels = rows.map((r,i)=>{
        const lab = String(r.Mes||'').replace(/^\s*\d{1,2}\s*[.\-\/]\s*/,'');
        if(rows.length>12 && (i%2===1)) return '';
        return `<text x="${x(i)}" y="${padT+plotH+18}" text-anchor="middle" fill="rgba(255,255,255,.70)" font-size="10">${escHtml(lab.slice(0,10))}</text>`;
      }).join('');

      return `
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="li" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="rgba(106,228,255,.95)"/><stop offset="1" stop-color="rgba(124,92,255,.75)"/>
            </linearGradient>
            <linearGradient id="le" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="rgba(255,204,102,.95)"/><stop offset="1" stop-color="rgba(255,107,107,.75)"/>
            </linearGradient>
            <linearGradient id="lu" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="rgba(61,220,151,.95)"/><stop offset="1" stop-color="rgba(61,220,151,.55)"/>
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.10)"/>
          <g stroke="rgba(255,255,255,.10)" stroke-width="1">
            <line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}"/>
          </g>
          <path d="${pI}" fill="none" stroke="url(#li)" stroke-width="3" stroke-linecap="round"/>
          <path d="${pE}" fill="none" stroke="url(#le)" stroke-width="3" stroke-linecap="round"/>
          <path d="${pU}" fill="none" stroke="url(#lu)" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 5"/>
          ${labels}
          <g transform="translate(${W-210},${H-24})" font-size="11" fill="rgba(255,255,255,.78)">
            <rect x="0" y="-10" width="10" height="10" rx="3" fill="url(#li)"/><text x="14" y="-1">Ingresos</text>
            <rect x="78" y="-10" width="10" height="10" rx="3" fill="url(#le)"/><text x="92" y="-1">Egresos</text>
            <rect x="152" y="-10" width="10" height="10" rx="3" fill="url(#lu)"/><text x="166" y="-1">Utilidad</text>
          </g>
        </svg>
      `;
    }

    function svgMarginBars(series){
      const rows = series.rows || [];
      const W=560, H=250, padL=52, padR=16, padT=18, padB=44;
      const plotW=W-padL-padR, plotH=H-padT-padB;
      if(!rows.length){
        return `<div class="small" style="color:var(--muted)">Sin datos para graficar.</div>`;
      }

      const clamp = (v)=> Math.max(-1, Math.min(1, v));
      const n = rows.length || 1;
      const band = plotW / n;
      const barW = Math.max(10, band*0.55);
      const baseY = padT + plotH/2;

      let bars = '';
      let labels = '';
      const esc = (s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      for(let i=0;i<rows.length;i++){
        const r = rows[i];
        const m = clamp(r.M);
        const x0 = padL + i*band + (band-barW)/2;
        const h = Math.abs(m) * (plotH/2);
        const y0 = m>=0 ? (baseY - h) : baseY;
        const fill = m>=0 ? 'rgba(61,220,151,.70)' : 'rgba(255,107,107,.70)';
        const tip = `${r.Mes||''}\nMargen: ${(r.M*100).toFixed(1)}%\nIngresos: ${fmtMoney(r.I)}\nEgresos: ${fmtMoney(r.E)}\nUtilidad: ${fmtMoney(r.U)}`;
        bars += `<g><title>${esc(tip)}</title><rect x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${barW.toFixed(2)}" height="${h.toFixed(2)}" rx="6" fill="${fill}"/></g>`;

        const lab = String(r.Mes||'').replace(/^\s*\d{1,2}\s*[.\-\/]\s*/,'');
        if(rows.length<=12 || (i%2===0)){
          const lx = padL + i*band + band/2;
          labels += `<text x="${lx.toFixed(2)}" y="${(padT+plotH+18).toFixed(2)}" text-anchor="middle" fill="rgba(255,255,255,.70)" font-size="10">${escHtml(lab.slice(0,10))}</text>`;
        }
      }

      return `
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.10)"/>
          <g stroke="rgba(255,255,255,.14)" stroke-width="1">
            <line x1="${padL}" y1="${baseY}" x2="${W-padR}" y2="${baseY}"/>
          </g>
          ${bars}
          ${labels}
          <g font-size="11" fill="rgba(255,255,255,.78)">
            <text x="${padL}" y="${padT+12}">+100%</text>
            <text x="${padL}" y="${baseY-6}">0%</text>
            <text x="${padL}" y="${padT+plotH+12}">-100%</text>
          </g>
        </svg>
      `;
    }

    
    // Canvas interactivo: Margen neto mensual (tooltip con mouse/touch)
    function drawMarginCanvas(canvasId, tipId, series){
      const host = document.getElementById(canvasId);
      const tip = document.getElementById(tipId);
      if(!host) return;

      const rows = (series && series.rows) ? series.rows : [];
      const wrap = host.parentElement;
      const getW = ()=> (wrap ? wrap.clientWidth : host.clientWidth || 600);

      const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const W = Math.max(320, getW());
      const Hcss = 240;

      host.width = Math.round(W * DPR);
      host.height = Math.round(Hcss * DPR);
      host.style.height = Hcss + 'px';
      const ctx = host.getContext('2d');
      ctx.setTransform(DPR,0,0,DPR,0,0);

      // Layout
      const padL=56, padR=16, padT=16, padB=44;
      const plotW=W-padL-padR, plotH=Hcss-padT-padB;
      const baseY = padT + plotH/2;

      // Background
      ctx.clearRect(0,0,W,Hcss);
      const rr = 16;
      ctx.save();
      // rounded rect
      ctx.beginPath();
      ctx.moveTo(rr,0); ctx.lineTo(W-rr,0); ctx.quadraticCurveTo(W,0,W,rr);
      ctx.lineTo(W,Hcss-rr); ctx.quadraticCurveTo(W,Hcss,W-rr,Hcss);
      ctx.lineTo(rr,Hcss); ctx.quadraticCurveTo(0,Hcss,0,Hcss-rr);
      ctx.lineTo(0,rr); ctx.quadraticCurveTo(0,0,rr,0);
      ctx.closePath();
      ctx.fillStyle='rgba(255,255,255,.02)';
      ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.10)';
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.restore();

      // Axis line (0%)
      ctx.strokeStyle='rgba(255,255,255,.14)';
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(padL, baseY);
      ctx.lineTo(W-padR, baseY);
      ctx.stroke();

      if(!rows.length){
        ctx.fillStyle='rgba(255,255,255,.70)';
        ctx.font='12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillText('Sin datos para graficar.', padL, padT+20);
        return;
      }

      // Scale [-1, 1] (±100%)
      const clamp = (v)=> Math.max(-1, Math.min(1, v));
      const n = rows.length || 1;
      const band = plotW / n;
      const barW = Math.max(10, band*0.55);

      const bars = [];
      for(let i=0;i<n;i++){
        const r = rows[i];
        const m = clamp(r.M);
        const x0 = padL + i*band + (band-barW)/2;
        const h = Math.abs(m) * (plotH/2);
        const y0 = m>=0 ? (baseY - h) : baseY;
        bars.push({x:x0, y:y0, w:barW, h:h, r:r});
        // draw bar
        ctx.fillStyle = (m>=0) ? 'rgba(61,220,151,.70)' : 'rgba(255,107,107,.70)';
        roundRect(ctx, x0, y0, barW, h, 6);
        ctx.fill();
      }

      // Y labels
      ctx.fillStyle='rgba(255,255,255,.78)';
      ctx.font='11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillText('+100%', padL, padT+12);
      ctx.fillText('0%', padL, baseY-6);
      ctx.fillText('-100%', padL, padT+plotH+12);

      // X labels
      ctx.fillStyle='rgba(255,255,255,.70)';
      ctx.font='10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      for(let i=0;i<n;i++){
        if(n>12 && i%2===1) continue;
        const r = rows[i];
        const labRaw = String(r.Mes||'').replace(/^\\s*\\d{1,2}\\s*[.\\-\\/]\\s*/,'');
        const lab = labRaw.slice(0,10);
        const lx = padL + i*band + band/2;
        ctx.textAlign='center';
        ctx.fillText(lab, lx, padT+plotH+18);
      }
      ctx.textAlign='left';

      // Tooltip helpers
      const showTip = (x,y, r)=>{
        if(!tip) return;
        const mPct = (r.M*100);
        const html = `<div><strong>${escHtml(r.Mes||'')}</strong></div>
                      <div class="mut">Margen: ${mPct.toFixed(1)}%</div>
                      <div class="mut">Ingresos: ${fmtMoney(r.I)}</div>
                      <div class="mut">Egresos: ${fmtMoney(r.E)}</div>
                      <div class="mut">Utilidad: ${fmtMoney(r.U)}</div>`;
        tip.innerHTML = html;
        tip.style.display='block';
        const rect = host.getBoundingClientRect();
        // position relative to wrapper
        const px = Math.max(8, Math.min((x - rect.left) + 12, W - 260));
        const py = Math.max(8, Math.min((y - rect.top) - 10, Hcss - 90));
        tip.style.left = px + 'px';
        tip.style.top  = py + 'px';
      };
      const hideTip = ()=>{
        if(!tip) return;
        tip.style.display='none';
      };

      const hitTest = (clientX, clientY)=>{
        const rect = host.getBoundingClientRect();
        const x = (clientX - rect.left);
        const y = (clientY - rect.top);
        for(const b of bars){
          if(x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h){
            return {b, x:clientX, y:clientY};
          }
        }
        return null;
      };

      // Clean previous handlers (idempotent)
      host.onmousemove = null;
      host.onmouseleave = null;
      host.ontouchstart = null;
      host.ontouchmove = null;
      host.ontouchend = null;

      host.onmousemove = (e)=>{
        const h = hitTest(e.clientX, e.clientY);
        if(h) showTip(h.x, h.y, h.b.r); else hideTip();
      };
      host.onmouseleave = ()=> hideTip();

      // Touch support
      host.ontouchstart = (e)=>{
        const t = e.touches && e.touches[0];
        if(!t) return;
        const h = hitTest(t.clientX, t.clientY);
        if(h){ showTip(h.x, h.y, h.b.r); }
      };
      host.ontouchmove = (e)=>{
        const t = e.touches && e.touches[0];
        if(!t) return;
        const h = hitTest(t.clientX, t.clientY);
        if(h){ showTip(h.x, h.y, h.b.r); } else hideTip();
      };
      host.ontouchend = ()=> hideTip();
    }
    function drawTrendCanvas(canvasId, tipId, series){
      const host = document.getElementById(canvasId);
      const tip = document.getElementById(tipId);
      if(!host) return;

      const rows = (series && series.rows) ? series.rows : [];
      const wrap = host.parentElement;
      const getW = ()=> (wrap ? wrap.clientWidth : host.clientWidth || 600);

      const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const W = Math.max(320, getW());
      const Hcss = 240;

      host.width = Math.floor(W * DPR);
      host.height = Math.floor(Hcss * DPR);
      host.style.height = Hcss + 'px';
      host.style.width = '100%';

      const ctx = host.getContext('2d');
      ctx.setTransform(DPR,0,0,DPR,0,0);
      ctx.clearRect(0,0,W,Hcss);

      if(!rows.length){
        ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255,255,255,.65)';
        ctx.fillText('Sin datos para graficar.', 12, 20);
        return;
      }

      const padL=52, padR=16, padT=14, padB=44;
      const plotW = W - padL - padR;
      const plotH = Hcss - padT - padB;

      const maxV = Math.max(1, ...rows.map(r=>Math.max(r.I||0, r.E||0, Math.abs(r.U||0))));
      const xAt = (i)=> padL + (rows.length===1 ? plotW/2 : (i*(plotW/(rows.length-1))));
      const yAt = (v)=> padT + (1 - (v/maxV))*plotH;

      // Axes
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath();
      ctx.moveTo(padL, padT);
      ctx.lineTo(padL, padT+plotH);
      ctx.lineTo(padL+plotW, padT+plotH);
      ctx.stroke();

      // Labels (X)
      ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.fillStyle = 'rgba(255,255,255,.70)';
      rows.forEach((r,i)=>{
        if(rows.length>12 && (i%2===1)) return;
        const lab = String(r.Mes||'').replace(/^\s*\d{1,2}\s*[.\-\/]\s*/,'').slice(0,10);
        const xx = xAt(i);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillText(lab, xx, padT+plotH+18);
        ctx.restore();
      });

      // Helper to draw a series
      function drawSeries(key, strokeStyle){
        ctx.lineWidth = 2;
        ctx.strokeStyle = strokeStyle;
        ctx.beginPath();
        rows.forEach((r,i)=>{
          const v = Math.max(0, Number(r[key]||0));
          const xx = xAt(i), yy = yAt(v);
          if(i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
        });
        ctx.stroke();

        // Points
        ctx.fillStyle = strokeStyle;
        rows.forEach((r,i)=>{
          const v = Math.max(0, Number(r[key]||0));
          const xx = xAt(i), yy = yAt(v);
          ctx.beginPath(); ctx.arc(xx,yy,3,0,Math.PI*2); ctx.fill();
        });
      }

      // Colors: consistent con el dashboard (sin depender de CSS var exacta)
      drawSeries('I','rgba(106,228,255,.95)');
      drawSeries('E','rgba(255,204,102,.95)');
      drawSeries('U','rgba(61,220,151,.95)');

      // Legend
      const legend = [
        ['Ingresos','rgba(106,228,255,.95)'],
        ['Egresos','rgba(255,204,102,.95)'],
        ['Utilidad','rgba(61,220,151,.95)']
      ];
      let lx = padL, ly = padT+10;
      ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
      ctx.textAlign = 'left';
      legend.forEach(([name,col],k)=>{
        const ox = lx + k*110;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ox, ly, 4, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(name, ox+10, ly+4);
      });

      // Interaction: nearest point by mouse x
      function nearestIndex(clientX){
        const rect = host.getBoundingClientRect();
        const px = clientX - rect.left;
        let best = 0, bestD = Infinity;
        for(let i=0;i<rows.length;i++){
          const d = Math.abs(px - xAt(i));
          if(d < bestD){ bestD = d; best = i; }
        }
        return {idx:best, rect};
      }

      function showAt(idx, rect, clientX, clientY){
        const r = rows[idx];
        const xx = xAt(idx), yy = padT + plotH;
        // redraw with guideline + highlight (cheap: clear and redraw)
        ctx.setTransform(DPR,0,0,DPR,0,0);
        ctx.clearRect(0,0,W,Hcss);

        // axes
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,.14)';
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT+plotH);
        ctx.lineTo(padL+plotW, padT+plotH);
        ctx.stroke();

        // x labels
        ctx.font = '10px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = 'rgba(255,255,255,.70)';
        rows.forEach((rr,i)=>{
          if(rows.length>12 && (i%2===1)) return;
          const lab = String(rr.Mes||'').replace(/^\s*\d{1,2}\s*[.\-\/]\s*/,'').slice(0,10);
          ctx.save();
          ctx.textAlign = 'center';
          ctx.fillText(lab, xAt(i), padT+plotH+18);
          ctx.restore();
        });

        // series
        drawSeries('I','rgba(106,228,255,.95)');
        drawSeries('E','rgba(255,204,102,.95)');
        drawSeries('U','rgba(61,220,151,.95)');

        // legend
        ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.textAlign = 'left';
        legend.forEach(([name,col],k)=>{
          const ox = padL + k*110;
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox, padT+10, 4, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(name, ox+10, padT+14);
        });

        // guideline
        ctx.strokeStyle = 'rgba(255,255,255,.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT+plotH); ctx.stroke();

        // highlight points larger
        const pts = [
          ['I','rgba(106,228,255,.95)'],
          ['E','rgba(255,204,102,.95)'],
          ['U','rgba(61,220,151,.95)']
        ];
        pts.forEach(([k,col])=>{
          const v = Math.max(0, Number(r[k]||0));
          const y = yAt(v);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(xx,y,5,0,Math.PI*2); ctx.fill();
        });

        if(tip){
          const lab = String(r.Mes||'');
          const html = `<div class="t">${escHtml(lab)}</div>
                        <div>Ingresos: <b>${fmtMoney(r.I||0)}</b></div>
                        <div>Egresos: <b>${fmtMoney(r.E||0)}</b></div>
                        <div>Utilidad: <b>${fmtMoney(r.U||0)}</b></div>`;
          tip.innerHTML = html;
          tip.style.display = 'block';

          // position tooltip near cursor but inside box
          const bx = Math.min(Math.max(8, (clientX - rect.left) + 12), rect.width - 190);
          const by = Math.min(Math.max(8, (clientY - rect.top) - 10), rect.height - 90);
          tip.style.left = bx + 'px';
          tip.style.top = by + 'px';
        }
      }

      function hide(){
        if(tip) tip.style.display = 'none';
        // redraw without guideline
        drawTrendCanvas(canvasId, tipId, series);
      }

      host.addEventListener('mousemove', (ev)=>{
        const {idx, rect} = nearestIndex(ev.clientX);
        showAt(idx, rect, ev.clientX, ev.clientY);
      });
      host.addEventListener('mouseleave', hide);

      // touch
      host.addEventListener('touchstart', (ev)=>{
        const t = ev.touches && ev.touches[0];
        if(!t) return;
        const {idx, rect} = nearestIndex(t.clientX);
        showAt(idx, rect, t.clientX, t.clientY);
      }, {passive:true});
      host.addEventListener('touchmove', (ev)=>{
        const t = ev.touches && ev.touches[0];
        if(!t) return;
        const {idx, rect} = nearestIndex(t.clientX);
        showAt(idx, rect, t.clientX, t.clientY);
      }, {passive:true});
      host.addEventListener('touchend', hide, {passive:true});
    }


    function roundRect(ctx,x,y,w,h,r){
      const rr = Math.min(r, w/2, h/2);
      ctx.beginPath();
      ctx.moveTo(x+rr,y);
      ctx.lineTo(x+w-rr,y);
      ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
      ctx.lineTo(x+w,y+h-rr);
      ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
      ctx.lineTo(x+rr,y+h);
      ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
      ctx.lineTo(x,y+rr);
      ctx.quadraticCurveTo(x,y,x+rr,y);
      ctx.closePath();
    }
function renderFinanceModule(){
      const box = document.getElementById('finModule');
      if(!box) return; // safety

      const yearSel = selectedYearFallback();
      const series = computeMonthlySeriesForYear(yearSel);

      const $y = document.getElementById('finYearPill');
      if($y) $y.textContent = 'Año: ' + (yearSel || '—');

      const n = series.nMonths || 0;
      const rrI = series.avgI * 12;
      const rrE = series.avgE * 12;

      const setTxt = (id, val)=>{ const el=document.getElementById(id); if(el) el.textContent = val; };

      setTxt('finIngYTD', fmtMoney(series.ytdI));
      setTxt('finEgrYTD', fmtMoney(series.ytdE));
      setTxt('finUtilYTD', fmtMoney(series.ytdU));
      setTxt('finMargYTD', isFinite(series.ytdM) ? fmtPct(series.ytdM) : '—');

      setTxt('finIngRR', `Run-rate anual: ${fmtMoney(rrI)} (prom. ${fmtMoney(series.avgI)} / mes, ${n} meses)`);
      setTxt('finEgrRR', `Run-rate anual: ${fmtMoney(rrE)} (prom. ${fmtMoney(series.avgE)} / mes, ${n} meses)`);
      setTxt('finUtilRR', `Prom. mensual: ${fmtMoney(series.avgU)} (YTD / ${n||0})`);

      const c1 = document.getElementById('finChartLine');
      const c2 = document.getElementById('finChartMargin');
      if(c1){
        c1.innerHTML = '<div style="position:relative;width:100%">'
          + '<canvas id="finTrendCanvas" style="width:100%;height:240px"></canvas>'
          + '<div id="finTrendTip" class="finTip" style="display:none"></div>'
          + '</div>';
        try{ drawTrendCanvas('finTrendCanvas','finTrendTip', series); }catch(e){ console.warn('drawTrendCanvas', e); }
      }

      if(c2){
        // Reemplazo: gráfica interactiva con canvas + tooltip (más confiable que <title> en SVG)
        c2.innerHTML = '<div style="position:relative;width:100%"><canvas id="finMarginCanvas" style="width:100%;height:240px;display:block"></canvas><div id="finMarginTip" class="finTip" style="display:none"></div></div>';
        try{ drawMarginCanvas('finMarginCanvas','finMarginTip', series); }catch(e){ console.warn('drawMarginCanvas', e); }
      }
      // --- Alertas financieras automáticas ---
      const thrInput = document.getElementById('finMargThr');
      const list = document.getElementById('finAlertsList');

      // Margen mínimo (persistente)
      const thrKey = 'fin_margen_min_pct';
      let thrPct = Number((localStorage.getItem(thrKey) || '25'));
      if(!isFinite(thrPct) || thrPct<0) thrPct = 25;
      if(thrInput){
        thrInput.value = String(Math.round(thrPct));
        thrInput.onchange = ()=>{
          const v = Number(thrInput.value||0);
          const vv = (isFinite(v) && v>=0) ? v : 0;
          localStorage.setItem(thrKey, String(vv));
          renderFinanceModule();
        };
      }

      // Helpers para crear alertas
      const addAlert = (level, title, detail)=>{
        if(!list) return;
        const div = document.createElement('div');
        div.className = 'finAlert ' + level;
        div.innerHTML = `<div class="dot"></div>
                         <div><div class="aT">${title}</div><div class="aD">${detail}</div></div>`;
        list.appendChild(div);
      };

      if(list) list.innerHTML = '';

      // 1) Margen neto (YTD) < X%
      const thr = (thrPct/100);
      if(isFinite(series.ytdM)){
        if(series.ytdM < thr){
          addAlert('warn', `Margen neto YTD bajo (< ${Math.round(thrPct)}%)`,
            `Margen actual: ${fmtPct(series.ytdM)}. Revisa estructura de costos o precio promedio.`);
        } else {
          addAlert('good', `Margen neto YTD saludable (≥ ${Math.round(thrPct)}%)`,
            `Margen actual: ${fmtPct(series.ytdM)}.`);
        }
      } else {
        addAlert('warn', 'Margen neto YTD no disponible', 'No hay ingresos suficientes para calcular el margen.');
      }

      // 2) Egresos creciendo más rápido que ingresos (último mes vs mes anterior)
      const rows = series.rows || [];
      if(rows.length >= 2){
        const a = rows[rows.length-2];
        const b = rows[rows.length-1];
        const gE = a.E>0 ? ((b.E - a.E)/a.E) : (b.E>0 ? 1 : 0);
        const gI = a.I>0 ? ((b.I - a.I)/a.I) : (b.I>0 ? 1 : 0);
        if(gE > gI + 0.05 && b.E>0){
          addAlert('bad', 'Egresos creciendo más rápido que ingresos',
            `Último mes (${b.Mes}): Egresos ${fmtMoney(b.E)} vs ${a.Mes}: ${fmtMoney(a.E)} (${fmtPct(gE)}). `+
            `Ingresos ${fmtMoney(b.I)} vs ${a.Mes}: ${fmtMoney(a.I)} (${fmtPct(gI)}).`);
        } else {
          addAlert('good', 'Crecimiento de egresos controlado',
            `Cambio último mes: Egresos ${fmtPct(gE)} vs Ingresos ${fmtPct(gI)}.`);
        }
      } else {
        addAlert('warn', 'Crecimiento mensual no evaluable', 'Se requieren al menos 2 meses con movimientos.');
      }

      // 3) Run-rate proyectado vs esperado ($ esperado mensual configurable)
      const expInp = document.getElementById('expectedIncome');
      const expMonthly = expInp ? Number(expInp.value||0) : 0;
      const expAnnual = expMonthly * 12;
      if(expAnnual > 0){
        const ratio = rrI / expAnnual;
        if(ratio < 0.75){
          addAlert('bad', 'Run-rate de ingresos muy por debajo del esperado',
            `Run-rate: ${fmtMoney(rrI)} vs esperado anual: ${fmtMoney(expAnnual)} (ratio ${fmtPct(ratio)}).`);
        } else if(ratio < 0.90){
          addAlert('warn', 'Run-rate de ingresos por debajo del esperado',
            `Run-rate: ${fmtMoney(rrI)} vs esperado anual: ${fmtMoney(expAnnual)} (ratio ${fmtPct(ratio)}).`);
        } else if(ratio > 1.10){
          addAlert('good', 'Run-rate de ingresos por arriba del esperado',
            `Run-rate: ${fmtMoney(rrI)} vs esperado anual: ${fmtMoney(expAnnual)} (ratio ${fmtPct(ratio)}).`);
        } else {
          addAlert('good', 'Run-rate de ingresos en rango esperado',
            `Run-rate: ${fmtMoney(rrI)} vs esperado anual: ${fmtMoney(expAnnual)} (ratio ${fmtPct(ratio)}).`);
        }
      } else {
        addAlert('warn', 'Esperado mensual de ingresos no configurado',
          'Define el esperado mensual en el menú (abajo) para evaluar el run-rate proyectado.');
      }

    }

    
    function updateTitleFilters(){
      // Enfoque robusto: usa directamente el estado actual (Año single-select; Mes esclavo)
      const yearSel = (Array.from(FILTER_STATE['Año']||[])[0] || selectedYearFallback() || '—');

      // Mes: si está vacío, asumir todos los meses del año seleccionado
      let monthsSel = Array.from(FILTER_STATE.Mes || []);
      const allMes = getAllValuesForFilter('Mes') || [];
      if(monthsSel.length===0 && yearSel && yearSel!=='—'){
        monthsSel = allMes.filter(m=>yearFromMes(m)===yearSel);
      }

      // Ordenar meses según el orden real del filtro
      const order = new Map(allMes.map((v,i)=>[String(v), i]));
      monthsSel.sort((a,b)=> (order.get(String(a)) ?? 1e9) - (order.get(String(b)) ?? 1e9));

      const fmtMonths = (arr, maxItems=6)=>{
        const clean = arr.map(v=>String(v).trim()).filter(Boolean);
        if(!clean.length) return '—';
        // si están todos los meses del año, mostrar (todos)
        const allOfYear = (yearSel && yearSel!=='—') ? allMes.filter(m=>yearFromMes(m)===yearSel) : allMes;
        if(allOfYear.length && clean.length === allOfYear.length) return '(todos)';
        if(clean.length>maxItems) return clean.slice(0,maxItems).join(', ') + ` … (+${clean.length-maxItems})`;
        return clean.join(', ');
      };

      const yTxt = yearSel || '—';
      const mTxt = fmtMonths(monthsSel, 6);

      const top = document.getElementById('titleFiltersTop');
      const main = document.getElementById('titleFiltersMain');
      if(top) top.textContent = `• Año: ${yTxt} • Mes: ${mTxt}`;
      if(main) main.textContent = `• Año: ${yTxt} • Mes: ${mTxt}`;

      const fin = document.getElementById('finTitleFilters');
      if(fin) fin.textContent = `• Año: ${yTxt} • Mes: ${mTxt}`;
}


function renderReservationsView(){
  // KPIs: reutilizamos los existentes para mostrar resumen rápido
  const agg = aggregateReservations();

  // Título/subtítulo
  document.getElementById('mainTableTitle').textContent = 'Reservas históricas (por alojamiento y tipo)';
  document.getElementById('mainTableSub').textContent = 'Datos desde Cloud Run. Click en un renglón para ver el detalle.';

  // KPIs (se muestran en la barra superior ya existente)
  // Egresos KPI -> total importe reservas
  document.getElementById('kRealE').textContent = fmtMoney(agg.totAmount);
  document.getElementById('kRowsE').textContent = agg.rows.length + ' grupos';
  // Ingresos KPI -> total reservas / noches
  document.getElementById('kRealI').textContent = agg.totBookings.toLocaleString('es-MX') + ' reservas';
  document.getElementById('kRowsI').textContent = agg.totNights.toLocaleString('es-MX') + ' noches';

  // barras: ocultamos significado (simple)
  setBar('pME', NaN, 'E');
  setBar('pMI', NaN, 'I');
  setBar('pYE', NaN, 'E');
  setBar('pYI', NaN, 'I');

  // Header (col names)
  try{ syncTipoUI(); }catch(e){}

  const tbody = document.getElementById('tbMain');
  tbody.innerHTML = '';

  agg.rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.dataset.key = r.key;
    tr.innerHTML = `
      <td>${escHtml(r.prop)}</td>
      <td>${escHtml(r.typ)}</td>
      <td class="num">${r.bookings.toLocaleString('es-MX')}</td>
      <td class="num">${r.nights.toLocaleString('es-MX')}</td>
      <td class="num">${fmtMoney(r.amount)}</td>
    `;
    tr.addEventListener('click', ()=>{
      SELECTED_KEY = r.key;
      SELECTED_SRC = 'R';
      renderReservationsDetails(r.key);
      highlightSelection();
    });
    tr.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){
        e.preventDefault();
        tr.click();
      }
    });
    tbody.appendChild(tr);
  });

  // default detail
  if(SELECTED_SRC !== 'R') {
    SELECTED_KEY = null;
    SELECTED_SRC = 'R';
  }
  if(SELECTED_KEY) renderReservationsDetails(SELECTED_KEY);
  else renderReservationsDetails(null);

  // Actualiza etiquetas del drawer (si aplica)
  try{ renderResFilterPanels(); }catch(e){}
}

function render(){
      const tipo = tipoVal();
      if(tipo==='R'){
        renderReservationsView();
        return;
      }
      const sE = aggregate('E');
      const sI = aggregate('I');
      const s = (tipo==='E') ? sE : sI;

      updateTitleFilters();

      // KPIs always visible
      document.getElementById('kRealE').textContent = fmtMoney(sE.realM);
      document.getElementById('kRowsE').textContent = sE.rows.length + ' filas';
      document.getElementById('kRealI').textContent = fmtMoney(sI.realM);
      document.getElementById('kRowsI').textContent = sI.rows.length + ' filas';

      document.getElementById('kAvME').textContent = isFinite(sE.avM) ? fmtPct(sE.avM) : '—';
      document.getElementById('kAvMEDesc').textContent = `Real ${fmtMoney(sE.realM)} / Presup. ${fmtMoney(sE.budM)}`;
      // KPIs Ingresos: Esperado fijo (parámetro) independiente de la selección
      const expectedIncomeM = Number(EXPECTED_INCOME_MONTHLY||0);
      const avMI_fixed = expectedIncomeM>0 ? (sI.realM/expectedIncomeM) : NaN;
      document.getElementById('kAvMI').textContent = isFinite(avMI_fixed) ? fmtPct(avMI_fixed) : '—';
      document.getElementById('kAvMIDesc').textContent = `Real ${fmtMoney(sI.realM)} / Esperado ${fmtMoney(expectedIncomeM)}`;

      document.getElementById('kAvYE').textContent = isFinite(sE.avY) ? fmtPct(sE.avY) : '—';
      document.getElementById('kAvYEDesc').textContent = sE.year ? `Año ${sE.year}: ${fmtMoney(sE.realY)} / ${fmtMoney(sE.budY)}` : '—';
      const expectedIncomeY = expectedIncomeM>0 ? (expectedIncomeM*12) : 0;
      const avYI_fixed = expectedIncomeY>0 ? (sI.realY/expectedIncomeY) : NaN;
      document.getElementById('kAvYI').textContent = isFinite(avYI_fixed) ? fmtPct(avYI_fixed) : '—';
      document.getElementById('kAvYIDesc').textContent = sI.year ? `Año ${sI.year}: ${fmtMoney(sI.realY)} / ${fmtMoney(expectedIncomeY)}` : '—';

      setBar('pME', sE.avM, 'E');
      setBar('pMI', avMI_fixed, 'I');
      setBar('pYE', sE.avY, 'E');
      setBar('pYI', avYI_fixed, 'I');

      const totalAlerts = (sE.alerts||0);
      const rt = document.getElementById('rtAlCount');
      if(rt) rt.textContent = String(totalAlerts);

      // main table
      syncTipoUI();
      const tb = document.getElementById('tbMain'); tb.innerHTML = '';

      if(tipo==='A'){
        
        const alertRows = [];
        const pushAlerts = (src, summary)=>{
          for(const r of summary.rows){
            if(src==='E'){
              if(!(r.BudAbs>0 && r.Av>1.0)) continue;
              const sev = sevOver(r.Av);
              alertRows.push({src, key:r.key, Cat:r.Cat, Con:r.Con, Mes:r.Mes, Av:r.Av, Sev:sev});
            } else {
              if(!(r.BudAbs>0 && r.Av<1.0)) continue;
              const sev = sevUnder(r.Av);
              alertRows.push({src, key:r.key, Cat:r.Cat, Con:r.Con, Mes:r.Mes, Av:r.Av, Sev:sev});
            }
          }
        };
        pushAlerts('E', sE);

        // orden: primero más severas
        alertRows.sort((a,b)=>{
          if(a.src!==b.src) return a.src==='E' ? -1 : 1; // egresos primero
          return a.src==='E' ? (b.Av-a.Av) : (a.Av-b.Av);
        });

        for(const r of alertRows){
          const tr = document.createElement('tr');
          tr.style.cursor='pointer';
          tr.dataset.key = r.key;
          tr.dataset.src = r.src;
          tr.innerHTML = `
            <td><span class="pill ${r.src==='E'?'bad':'good'}">${r.src==='E'?'Egreso':'Ingreso'}</span></td>
            <td>${r.Cat}</td>
            <td>${r.Con || '(sin concepto)'}</td>
            <td>${r.Mes}</td>
            <td class="num">${isFinite(r.Av)?fmtPct(r.Av):'—'}</td>
            <td><span class="${r.Sev.cls}">${r.Sev.label}</span></td>
          `;
          tr.addEventListener('click', ()=>{
            SELECTED_KEY = r.key;
            SELECTED_SRC = r.src;
            setRightView('detalle');
            renderDetails(SELECTED_KEY, 'A');
            // highlight selected
            [...tb.querySelectorAll('tr')].forEach(x=>x.classList.remove('selected'));
            tr.classList.add('selected');
          });
          tb.appendChild(tr);
        }

        if(alertRows.length===0){
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="6" style="color:var(--muted);padding:10px">Sin alertas para los filtros seleccionados.</td>`;
          tb.appendChild(tr);
        }

        // Render details if a selection exists
        if(SELECTED_KEY){
          renderDetails(SELECTED_KEY, 'A');
        } else {
          renderDetails(null, 'A');
        }
        return;
      }


      function barHTML(av){
        const pct = isFinite(av) ? Math.min(Math.max(av,0), 2.0) : 0;
        const sev = (tipo==='E') ? sevOver(av) : sevUnder(av);
        const cls = (tipo==='E') ? pbarClassOver(av) : pbarClassUnder(av);
        return `
          <div class="small">${isFinite(av)?fmtPct(av):'—'} <span class="${sev.cls}">${sev.label}</span></div>
          <div class="${cls}"><div class="marker" title="100%"></div><i style="width:${(pct*100).toFixed(1)}%"></i></div>
        `;
      }

      for(const r of s.rows){
        const tr = document.createElement('tr');
        tr.dataset.key = r.key;

        if(tipo==='E'){
          const isAlert = (r.BudAbs>0 && r.Av>1.0);
          const alertPill = isAlert ? '<span class="pill bad">⚠️</span>' : '<span class="pill good">OK</span>';
          tr.innerHTML = `
          <td>${r.Cat}</td>
          <td>${r.Con || '(sin concepto)'}</td>
          <td>${r.Mes}</td>
          <td class="num">${fmtMoney(r.RealAbs)}</td>
          <td class="num">${fmtMoney(r.BudAbs)}</td>
          <td>${barHTML(r.Av)}</td>
          <td>${alertPill}</td>
        `;
        } else if(tipo==='I'){
          // Ingresos: SIN columnas Cumpl./Alerta en la tabla principal
          tr.innerHTML = `
          <td>${r.Cat}</td>
          <td>${r.Con || '(sin concepto)'}</td>
          <td>${r.Mes}</td>
          <td class="num">${fmtMoney(r.RealAbs)}</td>
        `;
        } else {
          // Alertas tab (rows ya están prefiltradas)
          tr.innerHTML = `
          <td>${r.Cat}</td>
          <td>${r.Con || '(sin concepto)'}</td>
          <td>${r.Mes}</td>
          <td class="num">${isFinite(r.Av)?fmtPct(r.Av):'—'}</td>
          <td><span class="${r.Sev.cls}">${r.Sev.label}</span></td>
        `;
        }
        tr.addEventListener('click', ()=>{
          document.querySelectorAll('#tbMain tr.selected').forEach(x=>x.classList.remove('selected'));
          tr.classList.add('selected');
          SELECTED_KEY = r.key;
          setRightView('detalle');
          renderDetails(SELECTED_KEY, tipo);
        });
        tb.appendChild(tr);
      }

      // keep detail panel consistent
      if(SELECTED_KEY){
        const exists = s.rows.some(r=>r.key===SELECTED_KEY);
        if(exists) renderDetails(SELECTED_KEY, tipo);
        else { SELECTED_KEY=null; renderDetails(null, tipo); }
      } else {
        renderDetails(null, tipo);
      }

      window.__rows = s.rows;
      document.getElementById('lastUpdate').textContent = 'Última actualización: ' + new Date().toLocaleString('es-MX');
      refreshToggleButtons();
      updateAllLabels();
      renderFinanceModule();
    }

    async function onRefresh(){
      const snap = {
        "Año": new Set(FILTER_STATE['Año']),
        Mes: new Set(FILTER_STATE.Mes),
        CATEGORIA: new Set(FILTER_STATE.CATEGORIA),
        CONCEPTO: new Set(FILTER_STATE.CONCEPTO),
        "Cuenta bancaria": new Set(FILTER_STATE["Cuenta bancaria"]),
        q: document.getElementById('q').value,
        open: { dAno: document.getElementById('dAno')?.open, dMes: document.getElementById('dMes').open, dCat: document.getElementById('dCat').open, dCon: document.getElementById('dCon').open, dCta: document.getElementById('dCta').open }
      };

      const ok = await loadLive();
      if(ok){
        const allAno = getAllValuesForFilter('Año');

        const allMes = getAllValuesForFilter('Mes');
        const allCat = getAllValuesForFilter('CATEGORIA');
        const allCon = getAllValuesForFilter('CONCEPTO');
        const allCta = getAllValuesForFilter('Cuenta bancaria');

        const restoreSet = (allVals, prevSet)=>{
          if(!prevSet || prevSet.size===0) return new Set(allVals);
          const inter = new Set(allVals.filter(v=>prevSet.has(v)));
          return inter.size ? inter : new Set(allVals);
        };
        FILTER_STATE['Año'] = restoreSet(allAno, snap['Año']);
        // Año: forzar selección única (toma el más reciente si hay más de uno)
        if(FILTER_STATE['Año'].size>1){
          const y = Array.from(FILTER_STATE['Año']).sort((a,b)=>b.localeCompare(a,'es'))[0];
          FILTER_STATE['Año'] = new Set([y]);
        }

        FILTER_STATE.Mes = restoreSet(allMes, snap.Mes);
        // Mes es esclavo del Año seleccionado
        const ySel = Array.from(FILTER_STATE['Año'])[0] || selectedYearFallback();
        if(ySel){
          FILTER_STATE.Mes = new Set(allMes.filter(m=>yearFromMes(m)===ySel));
        }
        FILTER_STATE.CATEGORIA = restoreSet(allCat, snap.CATEGORIA);
        FILTER_STATE.CONCEPTO = restoreSet(allCon, snap.CONCEPTO);
        FILTER_STATE["Cuenta bancaria"] = restoreSet(allCta, snap["Cuenta bancaria"]);

        document.getElementById('q').value = snap.q || '';
        if(document.getElementById('dAno')) document.getElementById('dAno').open = !!snap.open.dAno;
        document.getElementById('dMes').open = !!snap.open.dMes;
        document.getElementById('dCat').open = !!snap.open.dCat;
        document.getElementById('dCon').open = !!snap.open.dCon;
        document.getElementById('dCta').open = !!snap.open.dCta;

        initFilterPanels();
      }
      render();
    }

    function hook(){
      document.getElementById('btnRefreshTop').addEventListener('click', onRefresh);
      document.getElementById('btnRefresh').addEventListener('click', onRefresh);



      // PDF (ventana de impresión / Guardar como PDF)
      document.getElementById('btnPDF').addEventListener('click', downloadPDF);
      const _pdf2 = document.getElementById('btnPDF2');
      // Indicadores financieros (ventana independiente)
      const btnFinWin = document.getElementById('btnFinWin');
      const finOverlay = document.getElementById('finOverlay');
      const btnFinClose = document.getElementById('btnFinClose');

      function openFin(){
        if(!finOverlay) return;
        finOverlay.classList.add('show');
        finOverlay.setAttribute('aria-hidden','false');
        // Re-render para ajustar gráficas al tamaño visible
        try{ renderFinanceModule(); }catch(e){}
      }
      function closeFin(){
        if(!finOverlay) return;
        finOverlay.classList.remove('show');
        finOverlay.setAttribute('aria-hidden','true');
      }

      if(btnFinWin) btnFinWin.addEventListener('click', openFin);
      if(btnFinClose) btnFinClose.addEventListener('click', closeFin);
      if(finOverlay) finOverlay.addEventListener('click', (e)=>{ if(e.target === finOverlay) closeFin(); });
      document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeFin(); });


      if(_pdf2) _pdf2.addEventListener('click', downloadPDF);

// PDF
      document.getElementById('q').addEventListener('input', ()=> render());

      document.getElementById('btnReset').addEventListener('click', ()=>{
        setDefaultAll();
        document.getElementById('q').value='';
        setTipo('E');
        initFilterPanels();
      });

      document.getElementById('tabE').addEventListener('click', ()=> setTipo('E'));
      document.getElementById('tabI').addEventListener('click', ()=> setTipo('I'));
      document.getElementById('tabA').addEventListener('click', ()=> setTipo('A'));
      document.getElementById('tabR').addEventListener('click', ()=> setTipo('R'));

      const rtDet = document.getElementById('rtDet');
      const rtAl  = document.getElementById('rtAl');
      if(rtDet) rtDet.addEventListener('click', ()=> setRightView('detalle'));
      if(rtAl) rtAl.addEventListener('click', ()=>{
        const tipo = tipoVal();
        const rows = (window.__rows || []).filter(r=> tipo==='E' ? (r.BudAbs>0 && r.Av>1.0) : (r.BudAbs>0 && r.Av<1.0));
        if(CURRENT_VIEW==='alertas'){
          setRightView('detalle');
          return;
        }
        renderAlertsList(rows, tipo);
      });
    }

    (async function(){
      hook();
      // no autorefresh; only initialize from current data
      await loadLive();
      loadExpectedIncomeParam();
      setDefaultAll();
      initFilterPanels();
      setTipo('E');
      setRightView('detalle');
      render();
    })();

    // ----------- Reporte PDF (sin librerías): abre ventana imprimible (Carta) y usa "Guardar como PDF" -----------
    function escHtml(s){
      return String(s ?? '').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    
function getFilterSummary(){
      // Para PDF: mostrar valores seleccionados (Año/Mes) en lugar de 1/3, 1/16
      const parts = [];

      const normText = (v)=> (v===null||v===undefined) ? '' : String(v).trim();

      const listVals = (name, maxItems=10)=>{
        const selArr = Array.from(FILTER_STATE[name] || []);
        if(selArr.length===0) return '(ninguno)';
        // Ordenar según el orden real del filtro, si existe
        const all = getAllValuesForFilter(name) || [];
        const order = new Map(all.map((v,i)=>[String(v), i]));
        selArr.sort((a,b)=> (order.get(String(a)) ?? 1e9) - (order.get(String(b)) ?? 1e9));

        const clean = selArr.map(normText).filter(Boolean);
        if(clean.length===0) return '(ninguno)';
        if(clean.length===all.length) return '(todos)';

        if(clean.length>maxItems){
          const head = clean.slice(0, maxItems).join(', ');
          return head + ` … (+${clean.length-maxItems})`;
        }
        return clean.join(', ');
      };

      const fCount = (name)=> {
        const all = getAllValuesForFilter(name) || [];
        const sel = (FILTER_STATE[name]||new Set()).size;
        if(sel===0) return name+': (ninguno)';
        if(sel===all.length) return name+': (todos)';
        return name+`: ${sel}/${all.length}`;
      };

      // Año/Mes: siempre valores
      parts.push(`Año: ${listVals('Año', 6)}`);
      parts.push(`Mes: ${listVals('Mes', 12)}`);

      // Resto: (todos) o conteo
      parts.push(fCount('CATEGORIA'));
      parts.push(fCount('CONCEPTO'));
      parts.push(fCount('Cuenta bancaria'));

      const q = norm(document.getElementById('q').value || '');
      if(q) parts.push('Búsqueda: "'+q+'"');

      return parts.join(' • ');
    }

    function aggByMonth(tipo){
      // Respeta el Mes seleccionado (para PDF por mes)
      ensureBudgetIndex(tipo);
      const recs = filteredRecords(tipo, false, ""); // ignore Mes, no forced year
      const m = new Map(); // mes => {real, bud}
      for(const r of recs){
        const Mes = norm(r.Mes);
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const bud = Math.abs(getBudgetMensual(tipo, Cat, Con));
        const cur = m.get(Mes) || {real:0, bud:0};
        cur.real += Math.abs(Number(r.Monto||0));
        cur.bud  += bud;
        m.set(Mes, cur);
      }
      const rows = [...m.entries()].map(([Mes,v])=>({Mes, Real:v.real, Bud:v.bud}));
      rows.sort((a,b)=>a.Mes.localeCompare(b.Mes,'es'));
      return rows;
    }

    function svgBarChartDual(incomeRows, expenseRows){
      // Simple dual bars per month (Ingresos vs Egresos). Uses max of both.
      const months = [...new Set([...incomeRows.map(r=>r.Mes), ...expenseRows.map(r=>r.Mes)])];
      months.sort((a,b)=>a.localeCompare(b,'es'));
      const iMap = new Map(incomeRows.map(r=>[r.Mes,r.Real]));
      const eMap = new Map(expenseRows.map(r=>[r.Mes,r.Real]));
      const vals = months.map(m=>({m, I:(iMap.get(m)||0), E:(eMap.get(m)||0)}));
      const maxV = Math.max(1, ...vals.map(v=>Math.max(v.I,v.E)));

      const W=960, H=260, padL=60, padR=20, padT=24, padB=54;
      const plotW = W-padL-padR, plotH = H-padT-padB;
      const n = vals.length || 1;
      const band = plotW/n;
      const barW = Math.max(8, band*0.28);
      const gap = Math.max(6, band*0.10);

      const y = (v)=> padT + (1 - (v/maxV))*plotH;

      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="gI" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(106,228,255,.85)"/>
            <stop offset="1" stop-color="rgba(124,92,255,.55)"/>
          </linearGradient>
          <linearGradient id="gE" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="rgba(255,204,102,.80)"/>
            <stop offset="1" stop-color="rgba(255,107,107,.55)"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.10)"/>
        <text x="${padL}" y="18" fill="rgba(255,255,255,.86)" font-size="14" font-weight="800">Ingresos vs Egresos por mes (selección)</text>
        <g stroke="rgba(255,255,255,.10)" stroke-width="1">
          <line x1="${padL}" y1="${padT+plotH}" x2="${W-padR}" y2="${padT+plotH}"/>
        </g>`;

      // bars + labels
      vals.forEach((v,idx)=>{
        const x0 = padL + idx*band + band/2;
        const xI = x0 - (barW + gap/2);
        const xE = x0 + gap/2;
        const hI = (v.I/maxV)*plotH;
        const hE = (v.E/maxV)*plotH;
        svg += `
          <rect x="${xI}" y="${y(v.I)}" width="${barW}" height="${hI}" rx="6" fill="url(#gI)"/>
          <rect x="${xE}" y="${y(v.E)}" width="${barW}" height="${hE}" rx="6" fill="url(#gE)"/>
        `;
        const label = (v.m||'').replace(/^\\d+\\.\\s*/,'');
        const lx = x0;
        const ly = padT+plotH+22;
        svg += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="rgba(255,255,255,.70)" font-size="10">${escHtml(label.slice(0,10))}</text>`;
      });

      // legend
      svg += `
        <g>
          <rect x="${W-220}" y="10" width="12" height="12" rx="3" fill="url(#gI)"/><text x="${W-202}" y="20" fill="rgba(255,255,255,.80)" font-size="12">Ingresos</text>
          <rect x="${W-120}" y="10" width="12" height="12" rx="3" fill="url(#gE)"/><text x="${W-102}" y="20" fill="rgba(255,255,255,.80)" font-size="12">Egresos</text>
        </g>
      `;
      svg += `</svg>`;
      return svg;
    }

    function topPartidas(tipo, limit=18){
      ensureBudgetIndex(tipo);
      const recs = filteredRecords(tipo, false);
      const g = new Map(); // Cat||Con => {real, bud}
      for(const r of recs){
        const Cat = norm(r.CATEGORIA);
        const Con = norm(r.CONCEPTO);
        const key = Cat+'||'+Con;
        const bud = Math.abs(getBudgetMensual(tipo, Cat, Con));
        const cur = g.get(key) || {Cat,Con, real:0, bud:0};
        cur.real += Math.abs(Number(r.Monto||0));
        cur.bud  += bud;
        g.set(key, cur);
      }
      const rows = [...g.values()].map(o=>{
        const av = o.bud>0 ? (o.real/o.bud) : NaN;
        const sev = (tipo==='E') ? sevOver(av) : sevUnder(av);
        return {...o, av, sev};
      });
      rows.sort((a,b)=>{
        // for Egresos: highest overrun first; for Ingresos: lowest compliance first
        if(tipo==='E'){
          const da = (isFinite(a.av)?a.av:0), db = (isFinite(b.av)?b.av:0);
          return (db-da);
        } else {
          const da = (isFinite(a.av)?a.av:9e9), db = (isFinite(b.av)?b.av:9e9);
          return (da-db);
        }
      });
      return rows.slice(0, limit);
    }

    function buildTableHTML(tipo){
      const rows = topPartidas(tipo, 22);
      const col2 = (tipo==='E') ? 'Presupuesto' : 'Esperado';
      const col3 = (tipo==='E') ? 'Avance' : 'Cumpl.';
      let h = `<table class="t">
        <thead><tr>
          <th>Categoría</th><th>Concepto</th><th class="num">Real</th><th class="num">${col2}</th><th class="num">${col3}</th><th>Sev</th>
        </tr></thead><tbody>`;
      for(const r of rows){
        h += `<tr>
          <td>${escHtml(r.Cat)}</td>
          <td>${escHtml(r.Con||'(sin concepto)')}</td>
          <td class="num">${escHtml(fmtMoney(r.real))}</td>
          <td class="num">${escHtml(fmtMoney(r.bud))}</td>
          <td class="num">${escHtml(isFinite(r.av)?fmtPct(r.av):'—')}</td>
          <td><span class="sev ${r.sev.cls.includes('bad')?'bad':(r.sev.cls.includes('warn')?'warn':'good')}">${escHtml(r.sev.label)}</span></td>
        </tr>`;
      }
      h += `</tbody></table>`;
      return h;
    }

    function buildAlertsTable(tipo){
      const s = aggregate(tipo);
      const rows = s.rows.filter(r=> tipo==='E' ? (r.BudAbs>0 && r.Av>1.0) : (r.BudAbs>0 && r.Av<1.0));
      rows.sort((a,b)=> tipo==='E' ? (b.Av-a.Av) : (a.Av-b.Av));
      const maxRows = rows.slice(0, 28);

      let h = `<table class="t">
        <thead><tr>
          <th>Categoría</th><th>Concepto</th><th>Mes</th>
          <th class="num">%</th><th>Sev</th>
        </tr></thead><tbody>`;
      for(const r of maxRows){
        h += `<tr>
          <td>${escHtml(r.Cat)}</td>
          <td>${escHtml(r.Con||'(sin concepto)')}</td>
          <td>${escHtml(r.Mes)}</td>
          <td class="num">${escHtml(isFinite(r.Av)?fmtPct(r.Av):'—')}</td>
          <td><span class="sev ${r.Sev.cls.includes('bad')?'bad':(r.Sev.cls.includes('warn')?'warn':'good')}">${escHtml(r.Sev.label)}</span></td>
        </tr>`;
      }
      h += `</tbody></table>`;
      return h;
    }

    function reportKPIsHTML(){
      const sE = aggregate('E');
      const sI = aggregate('I');

      const k = (label, value, sub, barClass, barWidth)=>`
        <div class="k">
          <div class="kt">${escHtml(label)}</div>
          <div class="kv">${escHtml(value)}</div>
          <div class="ks">${escHtml(sub||'')}</div>
          <div class="bar ${barClass}"><i style="width:${barWidth}"></i></div>
        </div>
      `;

      const w = (av)=> (isFinite(av)? (Math.min(Math.max(av,0),2)*50).toFixed(1)+'%' : '0%'); // 100% => 50% width (center marker in print not needed)
      const clsE = pbarClassOver(sE.avM).includes('bad')?'bad':(pbarClassOver(sE.avM).includes('warn')?'warn':'good');
      const clsI = pbarClassUnder(sI.avM).includes('bad')?'bad':(pbarClassUnder(sI.avM).includes('warn')?'warn':'good');
      const clsYE = pbarClassOver(sE.avY).includes('bad')?'bad':(pbarClassOver(sE.avY).includes('warn')?'warn':'good');
      const clsYI = pbarClassUnder(sI.avY).includes('bad')?'bad':(pbarClassUnder(sI.avY).includes('warn')?'warn':'good');

      const totalAlerts = (sE.alerts||0);

      return `
        <div class="kgrid">
          ${k('Egresos (selección)', fmtMoney(sE.realM), `${sE.rows.length} filas`, 'neutral', '0%')}
          ${k('Ingresos (selección)', fmtMoney(sI.realM), `${sI.rows.length} filas`, 'neutral', '0%')}
          ${k('Avance MENSUAL Egresos', isFinite(sE.avM)?fmtPct(sE.avM):'—', `Real ${fmtMoney(sE.realM)} / Presup. ${fmtMoney(sE.budM)}`, clsE, w(sE.avM))}
          ${k('Cumplimiento MENSUAL Ingresos', isFinite(sI.avM)?fmtPct(sI.avM):'—', `Real ${fmtMoney(sI.realM)} / Esperado ${fmtMoney(sI.budM)}`, clsI, w(sI.avM))}
          ${k('Avance ANUAL Egresos', isFinite(sE.avY)?fmtPct(sE.avY):'—', sE.year?`Año ${sE.year}: ${fmtMoney(sE.realY)} / ${fmtMoney(sE.budY)}`:'—', clsYE, w(sE.avY))}
          ${k('Cumplimiento ANUAL Ingresos', isFinite(sI.avY)?fmtPct(sI.avY):'—', sI.year?`Año ${sI.year}: ${fmtMoney(sI.realY)} / ${fmtMoney(sI.budY)}`:'—', clsYI, w(sI.avY))}
          ${k('Alertas (selección)', String(totalAlerts), `Egresos: ${sE.alerts||0} • Ingresos: ${sI.alerts||0}`, totalAlerts? 'bad':'neutral', totalAlerts? '70%':'0%')}
        </div>
      `;
    }


    function buildReportHTML(){
      // PDF: KPIs + tablas (exactamente las agregadas del dashboard). Sin alertas ni gráficas.
      const now = new Date();
      const fs = getFilterSummary();

      // Usamos la misma agregación del dashboard (ya respeta filtros actuales)
      const sE = aggregate('E');
      const sI = aggregate('I');

      function kpiCard(title, value, sub, pct){
        const hasPct = (pct!==null && pct!==undefined && isFinite(pct));
        const cls = !hasPct ? 'neutral' : (pct>=1 ? 'good' : (pct>=0.9 ? 'warn' : 'bad'));
        const w = !hasPct ? 0 : Math.max(0, Math.min(160, pct*100));
        return `<div class="k">
          <div class="kt">${escHtml(title)}</div>
          <div class="kv">${escHtml(value)}</div>
          ${sub?`<div class="ks">${escHtml(sub)}</div>`:''}
          ${hasPct?`<div class="bar ${cls}"><i style="width:${w}%"></i></div>`:''}
        </div>`;
      }

      // KPIs mensuales/anuales (con la lógica ya existente del dashboard)
      // Nota: sE.budM y sI.budM ya reflejan el "presupuesto/esperado" para el mes filtrado (o selección).
      const kpisHTML = `
        <div class="kgrid">
          ${kpiCard('Egresos (selección)', fmtMoney(sE.realM), 'Real (positivo)', null)}
          ${kpiCard('Presupuesto egresos (selección)', fmtMoney(sE.budM), 'Mensual (según filtros)', null)}
          ${kpiCard('Avance mensual egresos', (isFinite(sE.avM)?fmtPct(sE.avM):'—'), 'Real / Presupuesto', sE.avM)}
          ${kpiCard('Avance anual egresos', (isFinite(sE.avY)?fmtPct(sE.avY):'—'), `Año ${sE.year}: Real / (12×Presupuesto mensual)`, sE.avY)}

          ${kpiCard('Ingresos (selección)', fmtMoney(sI.realM), 'Real (positivo)', null)}
          ${kpiCard('Ingreso esperado (selección)', fmtMoney(sI.budM), 'Mensual (según filtros)', null)}
          ${kpiCard('Cumplimiento mensual ingresos', (isFinite(sI.avM)?fmtPct(sI.avM):'—'), 'Real / Esperado', sI.avM)}
          ${kpiCard('Cumplimiento anual ingresos', (isFinite(sI.avY)?fmtPct(sI.avY):'—'), `Año ${sI.year}: Real / (12×Esperado mensual)`, sI.avY)}
        </div>`;

      function pdfTable(tipo){
        const agg = (tipo==='E') ? sE : sI;
        const rows = agg.rows; // mismo orden del dashboard
        const isE = (tipo==='E');

        if(isE){
          const barClass = (av)=>{
            if(!isFinite(av)) return 'pbar neutral';
            if(av>=1.1) return 'pbar bad';
            if(av>=1.0) return 'pbar warn';
            return 'pbar good';
          };
          const sevLabel = (av)=>{
            if(!isFinite(av)) return {cls:'muted', label:'—'};
            if(av>=1.2) return {cls:'bad', label:'Crítica'};
            if(av>=1.1) return {cls:'warn', label:'Alerta'};
            if(av>=1.0) return {cls:'warn', label:'Límite'};
            return {cls:'good', label:'OK'};
          };
          const barHTMLpdf = (av)=>{
            const pct = isFinite(av) ? Math.min(Math.max(av,0), 2.0) : 0;
            const sev = sevLabel(av);
            const cls = barClass(av);
            return `
              <div class="small">${isFinite(av)?fmtPct(av):'—'} <span class="${sev.cls}">${sev.label}</span></div>
              <div class="${cls}"><div class="marker" title="100%"></div><i style="width:${(pct*100).toFixed(1)}%"></i></div>
            `;
          };
          const alertPill = (av, budAbs)=>{
            const isAlert = (budAbs>0 && isFinite(av) && av>1.0);
            return isAlert ? '<span class="pill bad">⚠️</span>' : '<span class="pill good">OK</span>';
          };

          let h = `<table class="t">
            <thead><tr>
              <th>Categoría</th><th>Concepto</th><th>Mes</th>
              <th class="num">Real</th><th class="num">Presupuesto</th><th>Avance</th><th>Alerta</th>
            </tr></thead><tbody>`;
          for(const r of rows){
            h += `<tr>
              <td>${escHtml(r.Cat)}</td>
              <td>${escHtml(r.Con||'(sin concepto)')}</td>
              <td>${escHtml(r.Mes)}</td>
              <td class="num">${fmtMoney(r.RealAbs)}</td>
              <td class="num">${fmtMoney(r.BudAbs)}</td>
              <td>${barHTMLpdf(r.Av)}</td>
              <td>${alertPill(r.Av, r.BudAbs)}</td>
            </tr>`;
          }
          h += `</tbody></table>`;
          return h;
        } else {
          // Ingresos: sin columna "Esperado"
          let h = `<table class="t">
            <thead><tr>
              <th>Categoría</th><th>Concepto</th><th>Mes</th>
              <th class="num">Real</th><th class="num">Cumpl.</th>
            </tr></thead><tbody>`;
          for(const r of rows){
            h += `<tr>
              <td>${escHtml(r.Cat)}</td>
              <td>${escHtml(r.Con||'(sin concepto)')}</td>
              <td>${escHtml(r.Mes)}</td>
              <td class="num">${escHtml(fmtMoney(r.RealAbs))}</td>
              <td class="num">${escHtml(isFinite(r.Av)?fmtPct(r.Av):'—')}</td>
            </tr>`;
          }
          h += `</tbody></table>`;
          return h;
        }
      }

      const html = `
<!doctype html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Reporte Ejecutivo - Monitor Financiero</title>
<style>
    :root{
      --bg:#070b14;
      --panel:rgba(255,255,255,.06);
      --line:rgba(255,255,255,.14);
      --text:rgba(255,255,255,.92);
      --muted:rgba(255,255,255,.65);
      --good:#3ddc97; --warn:#ffcc66; --bad:#ff6b6b;
      --accent:#6ae4ff; --accent2:#7c5cff;
      --shadow: 0 18px 55px rgba(0,0,0,.38);
    }
    *{box-sizing:border-box}
    body{
      margin:0; color:var(--text);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(1100px 750px at 10% 0%, rgba(106,228,255,.18), transparent 55%),
                  radial-gradient(1000px 700px at 90% 10%, rgba(124,92,255,.18), transparent 55%),
                  linear-gradient(180deg, var(--bg), #050814 70%);
      min-height:100vh;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overflow-x:hidden;
    }

    /* App bar */
    .appbar{
      position:sticky; top:0; z-index: 80;
      padding: 10px 12px calc(10px + env(safe-area-inset-top));
      display:flex; align-items:center; gap:10px;
      background: rgba(7,11,20,.72);
      backdrop-filter: blur(12px);
      border-bottom:1px solid rgba(255,255,255,.10);
    }
    .appbar .t{
      font-size:18px; font-weight:850; letter-spacing:.2px; line-height:1.1;
      background: linear-gradient(135deg, rgba(255,255,255,.96), rgba(255,255,255,.70));
      -webkit-background-clip:text; background-clip:text; color:transparent;
      flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .titleFilters{
      font-size:12px;
      font-weight:700;
      letter-spacing:.2px;
      opacity:.85;
      margin-left:8px;
      white-space:nowrap;
    }


    /* Buttons */
    button, .btnLike{
      padding:10px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.08); color:var(--text); cursor:pointer;
      transition: transform .12s ease, filter .12s ease, background .12s ease;
      font-weight:800;
      user-select:none;
    }
    button.primary{
      border-color: rgba(106,228,255,.35);
      background: linear-gradient(135deg, rgba(106,228,255,.20), rgba(124,92,255,.20));
    }
    button:hover, .btnLike:hover{filter:brightness(1.10); transform: translateY(-1px);}

    /* CSS-only drawer toggle */
    #navToggle{ position:absolute; left:-9999px; }
    .burgerLabel{
      width:42px;height:42px;border-radius:14px;
      border:1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.07);
      display:grid; place-items:center;
      cursor:pointer;
      transition: transform .12s ease, filter .12s ease;
      flex:0 0 auto;
    }
    .burgerLabel:hover{filter:brightness(1.1); transform: translateY(-1px);}
    .burgerLabel span{
      width:18px;height:2px;background: rgba(255,255,255,.85);
      display:block; border-radius:2px; position:relative;
    }
    .burgerLabel span:before,.burgerLabel span:after{
      content:""; position:absolute; left:0; right:0; height:2px; border-radius:2px;
      background: rgba(255,255,255,.85);
    }
    .burgerLabel span:before{top:-6px}
    .burgerLabel span:after{top:6px}

    .overlay{
      display:none;
      position:fixed; inset:0;
      background: rgba(0,0,0,.50);
      z-index: 90;
    }
    .drawer{
      position:fixed; top:0; left:0;
      width: min(420px, 92vw);
      height:100vh;
      background: rgba(12,18,34,.96);
      border-right:1px solid rgba(255,255,255,.14);
      box-shadow: 0 18px 55px rgba(0,0,0,.55);
      backdrop-filter: blur(12px);
      padding:14px;
      transform: translateX(-105%);
      transition: transform .18s ease;
      z-index: 100;
      overflow:auto;
      border-radius: 0 18px 18px 0;
    }
    /* When checked, show overlay + drawer */
    #navToggle:checked ~ .overlay{ display:block; }
    #navToggle:checked ~ .drawer{ transform: translateX(0); }
    /* Prevent background scroll when drawer open (best-effort) */
    #navToggle:checked ~ .wrap { filter: blur(0px); }

    .closeRow{display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;}
    .closeRow .h{font-weight:900; font-size:14px;}
    .closeX{
      width:42px;height:42px;border-radius:14px;
      display:grid;place-items:center;
      border:1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.08);
      cursor:pointer;
    }

    /* Content */
    .wrap{padding:12px; padding-bottom: calc(14px + env(safe-area-inset-bottom));}
    .card{
      background:rgba(255,255,255,.06);
      border:1px solid var(--line);
      border-radius:16px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }
    .main{padding:14px;}

    .titleBig{
      margin:0 0 4px 0;
      font-size:22px; font-weight:900; letter-spacing: .2px; line-height:1.1;
      background: linear-gradient(135deg, rgba(255,255,255,.96), rgba(255,255,255,.70));
      -webkit-background-clip:text; background-clip:text; color:transparent;
    }
    .subtitle{color:var(--muted); font-size:12px; margin-bottom:10px;}
    .small{font-size:12px; color:var(--muted)}
    .hr{height:1px; background: rgba(255,255,255,.10); margin:14px 0;}

    /* KPIs */
    .kpis{display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;}
    .kpi{padding:12px; background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); border-radius:16px; min-width:0;}
    .kpi .t{color:var(--muted); font-size:11px;}
    .kpi .v{font-size:16px; font-weight:800; margin-top:6px;}
    .kpi .s{color:var(--muted); font-size:11px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
    .kpiWide{grid-column: 1 / -1;}
    .kpiBtn{
      cursor:pointer;
      transition: transform .12s ease, filter .12s ease, background .12s ease;
    }
    .kpiBtn:hover{filter:brightness(1.10); transform: translateY(-1px);}
    .kpiBtn.active{
      border-color: rgba(255,107,107,.55);
      background: linear-gradient(135deg, rgba(255,107,107,.25), rgba(180,40,40,.35));
      box-shadow: 0 0 0 4px rgba(255,107,107,.20);
    }

    .pwrap{margin-top:8px}
    .pbar{
      height:10px; border-radius:999px;
      background: rgba(255,255,255,.10);
      overflow:hidden; border:1px solid rgba(255,255,255,.14);
      position:relative;
    }
    .pbar .marker{
      position:absolute; left:50%; top:-2px; bottom:-2px;
      width:2px; background: rgba(255,255,255,.45);
      border-radius:2px;
      transform: translateX(-1px);
    }
    .pbar i{display:block; height:100%; width:0%;}
    .pbar.good i{background: rgba(61,220,151,.75);}
    .pbar.warn i{background: rgba(255,204,102,.75);}
    .pbar.bad  i{background: rgba(255,107,107,.75);}

    .pill{
      display:inline-block; padding:4px 8px; border-radius:999px;
      border:1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06);
      font-size:12px;
      white-space:nowrap;
    }
    .pill.good{border-color: rgba(61,220,151,.35); background: rgba(61,220,151,.14);}
    .pill.warn{border-color: rgba(255,204,102,.35); background: rgba(255,204,102,.14);}
    .pill.bad {border-color: rgba(255,107,107,.35); background: rgba(255,107,107,.14);}

    /* Tabs */
    .topbar{
      display:flex; gap:8px; padding:10px;
      border:1px solid rgba(255,255,255,.12);
      border-radius:14px;
      background: rgba(255,255,255,.05);
      margin-top:12px;
      align-items:center;
      flex-wrap:wrap;
    }
    .topbar .spacer{flex:1}
    .tabs{
      display:flex; gap:8px; padding:4px;
      border-radius:14px;
      background: rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.12);
    }
    .tab{
      padding:10px 12px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      cursor:pointer;
      font-weight:900; font-size:12px;
      user-select:none;
      transition: transform .12s ease, filter .12s ease, background .12s ease;
    }
    .tab:hover{filter:brightness(1.10); transform: translateY(-1px);}
    .tab.active{
      border-color: rgba(106,228,255,.35);
      background: linear-gradient(135deg, rgba(106,228,255,.18), rgba(124,92,255,.18));
      box-shadow: 0 0 0 4px rgba(106,228,255,.06);
    }

    /* Tables */
    table{width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border-radius:14px;}
    thead th{
      text-align:left; font-size:11px; color:var(--muted);
      background: rgba(255,255,255,.06); border-bottom:1px solid rgba(255,255,255,.10);
      padding:10px;
      position:sticky; top:0; z-index:2;
    }
    tbody td{
      padding:10px; border-bottom:1px solid rgba(255,255,255,.08);
      font-size:12px;
      background: rgba(10,16,32,.35);
      vertical-align:top;
    }
    tbody tr:hover td{background: rgba(255,255,255,.06);}
    tbody tr.selected td{outline: 2px solid rgba(106,228,255,.35); background: rgba(106,228,255,.08);}
    .num{text-align:right; font-variant-numeric: tabular-nums;}

    .grid{display:grid; grid-template-columns: 1fr; gap:12px; margin-top:12px;}
    .panel{padding:12px; background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.12); border-radius:16px;}

    .scroll{
      overflow:auto;
      border-radius:14px;
      min-height: 260px;
      max-height: 56vh;
      resize: vertical;
      -webkit-overflow-scrolling: touch;
    }

    /* Filter UI inside drawer */
    .brand{
      display:flex; gap:12px; align-items:center; padding:10px 10px 12px;
      border-bottom:1px solid rgba(255,255,255,.10);
      margin:-6px -6px 10px;
    }
    .logo{
      width:34px;height:34px;border-radius:12px;
      background: linear-gradient(135deg, rgba(106,228,255,.65), rgba(124,92,255,.65));
      box-shadow: 0 0 0 8px rgba(106,228,255,.10), 0 0 22px rgba(124,92,255,.25);
    }
    .brand h1{margin:0; font-size:16px; letter-spacing:.2px;}
    .brand .sub{color:var(--muted); font-size:12px; margin-top:2px;}

    label{display:block; font-size:12px; color:var(--muted); margin:10px 0 6px;}
    .searchInput{
      width:100%;
      padding:11px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06); color: var(--text);
      outline:none;
    }
    details.fblock{
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.04);
      border-radius:14px;
      padding:10px 10px;
      margin-top:10px;
    }
    details.fblock > summary{
      cursor:pointer;
      list-style:none;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      font-weight:900;
      font-size:12px;
      color: rgba(255,255,255,.82);
    }
    details.fblock > summary::-webkit-details-marker{display:none;}
    .chev{opacity:.8}
    .comboPanel{
      margin-top:10px;
      background: rgba(12,18,34,.55);
      border:1px solid rgba(255,255,255,.12);
      border-radius:14px;
      padding:10px;
      max-height: 260px;
      overflow:auto;
      -webkit-overflow-scrolling: touch;
    }
    .comboTop{
      display:flex; gap:8px; align-items:center; margin-bottom:8px;
      position:sticky; top:0;
      background: rgba(12,18,34,.85);
      padding:4px 0 8px;
      border-bottom: 1px solid rgba(255,255,255,.10);
      z-index: 2;
    }
    .comboTop input{
      flex:1;
      padding:9px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.06);
      color: var(--text);
      outline:none;
      min-width:0;
    }
    .toggleAll{
      padding:8px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.08);
      font-size:12px;
      white-space:nowrap;
      cursor:pointer;
      user-select:none;
      flex:0 0 auto;
    }
    .toggleAll.on{
      border-color: rgba(106,228,255,.40);
      background: linear-gradient(135deg, rgba(106,228,255,.18), rgba(124,92,255,.18));
      box-shadow: 0 0 0 4px rgba(106,228,255,.08);
      font-weight:900;
    }
    .opt{
      display:flex; gap:10px; align-items:center;
      padding:8px 8px;
      border-radius:10px;
      cursor:pointer;
      user-select:none;
    }
    .opt:hover{background: rgba(255,255,255,.06);}
    .opt input{width:16px; height:16px;}
    .opt span{font-size:13px;}
    .status{margin-top:10px; font-size:12px; color:var(--muted);}
    .dot{display:inline-block; width:8px; height:8px; border-radius:999px; background:var(--accent); margin-right:6px;}
    .btns{display:flex; gap:8px; margin-top:12px; flex-wrap:wrap}
    .hide{display:none !important;}

    @media (min-width: 1024px){
      .wrap{padding:16px;}
      .titleBig{font-size:28px;}
      .subtitle{font-size:13px;}
      .kpis{grid-template-columns: 1fr 1fr 1fr 1fr;}
      .grid{grid-template-columns: 2fr 1fr;}
      .appbar .t{font-size:20px;}
    }
  
    /* --- Indicadores financieros (módulo adicional, seguro) --- */
    .finModule{margin-top:12px;}
    .finHeader{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:10px;}
    .finHeader .h{font-weight:950;font-size:14px;}
    .finHeader .sub{color:var(--muted);font-size:12px;}
    .finKpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .finKpi{padding:12px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}
    .finKpi .t{color:var(--muted);font-size:11px;}
    .finKpi .v{font-size:16px;font-weight:900;margin-top:6px;}
    .finKpi .s{color:var(--muted);font-size:11px;margin-top:4px;}

    .finAlerts{margin-top:10px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);padding:10px;}
    .finAlertsTop{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
    .finAlertsTop .ttl{font-weight:950;font-size:12px;}
    .finAlertsCtrl{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px;}
    .finAlertsCtrl input{width:90px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:var(--text);}
    .finAlertsList{margin-top:10px;display:flex;flex-direction:column;gap:8px;}
    .finAlert{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);}
    .finAlert .dot{width:10px;height:10px;border-radius:999px;margin-top:4px;}
    .finAlert .aT{font-weight:900;font-size:12px;}
    .finAlert .aD{color:var(--muted);font-size:11px;margin-top:2px;line-height:1.25;}
    .finAlert.good .dot{background:var(--good);}
    .finAlert.warn .dot{background:var(--warn);}
    .finAlert.bad  .dot{background:var(--bad);}
    .finCharts{display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px;}
    .svgBox{border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);padding:10px;}
    @media (min-width: 1024px){
      .finKpis{grid-template-columns:1fr 1fr 1fr 1fr;}
      .finCharts{grid-template-columns: 1fr 1fr;}
    }


    /* === Ventana independiente: Indicadores financieros === */
    .finOverlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999;padding:18px;}
    .finOverlay.show{display:flex;}
    .finWindow{width:min(1180px, 96vw);max-height:92vh;overflow:auto;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55); background: rgba(10,15,25,0.98); border:1px solid rgba(255,255,255,.14);}
    .finWindow .panel.finModule{margin:0;border-radius:16px; background: rgba(10,15,25,0.98);}
    .finHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
    .finHeaderRight{display:flex;align-items:center;gap:10px;}
    .iconBtn{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.18);color:rgba(255,255,255,.9);
      width:34px;height:34px;border-radius:10px;cursor:pointer;display:grid;place-items:center;}
    .iconBtn:hover{background:rgba(0,0,0,.28);}


    /* KPI cards (PDF) */
    .kgrid{
      display:grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap:12px;
      margin: 14px 0 16px;
    }
    .k{
      background: var(--panel);
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px 12px 10px;
      box-shadow: var(--shadow);
    }
    .kt{font-size:12px; color:var(--muted); margin-bottom:6px}
    .kv{font-size:20px; font-weight:800; letter-spacing:.2px}
    .ks{font-size:11px; color:var(--muted); margin-top:6px}
    .bar{
      height:8px;
      border-radius:999px;
      background: rgba(255,255,255,.12);
      overflow:hidden;
      margin-top:10px;
    }
    .bar i{display:block; height:100%; width:0%}
    .bar.good i{background: var(--good)}
    .bar.warn i{background: var(--warn)}
    .bar.bad  i{background: var(--bad)}
    @media (max-width: 980px){
      .kgrid{grid-template-columns: repeat(2, minmax(0,1fr));}
    }
</style></head><body>

  <div class="card">
    <div class="h1">Check Inn — Monitor Financiero (Reporte Ejecutivo)</div>
    <div class="meta">
      <span class="chip">Generado: ${escHtml(now.toLocaleString('es-MX'))}</span>
      <div><b>Filtros:</b> ${escHtml(fs)}</div>
    </div>
  </div>

  <div style="height:10px"></div>

  <div class="card">
    <div class="h2">Indicadores financieros</div>
    <div class="muted" style="margin-top:-6px;margin-bottom:10px;">
      Resumen del año seleccionado. Run-rate anual estimado = promedio mensual × 12.
    </div>
    ${(()=>{
      const yearSel = selectedYearFallback();
      const fin = computeMonthlySeriesForYear(yearSel);
      const expM = Number(EXPECTED_INCOME_MONTHLY||0);
      const expY = expM * 12;

      const rrI = fin.avgI * 12;
      const rrE = fin.avgE * 12;
      const rrU = rrI - rrE;
      const rrM = rrI>0 ? (rrU/rrI) : NaN;

      const k = [];
      k.push(kpiCard('Ingresos YTD', fmtMoney(fin.ytdI), `Año: ${yearSel||'—'}`, null));
      k.push(kpiCard('Egresos YTD', fmtMoney(fin.ytdE), `Año: ${yearSel||'—'}`, null));
      k.push(kpiCard('Utilidad neta YTD', fmtMoney(fin.ytdU), isFinite(fin.ytdM)?('Margen: '+fmtPct(fin.ytdM)):'Margen: —', null));
      k.push(kpiCard('Run-rate Ingresos (anual)', fmtMoney(rrI), `Esperado anual: ${fmtMoney(expY)}`, expY>0 ? (rrI/expY) : null));
      k.push(kpiCard('Run-rate Egresos (anual)', fmtMoney(rrE), 'Estimado por tendencia', null));
      k.push(kpiCard('Run-rate Utilidad (anual)', fmtMoney(rrU), isFinite(rrM)?('Margen: '+fmtPct(rrM)):'Margen: —', null));

      const rows = (fin.rows||[]).slice(0, 24).map(r=>{
        const m = escHtml(String(r.Mes||''));
        const I = fmtMoney(r.I||0);
        const E = fmtMoney(r.E||0);
        const U = fmtMoney(r.U||0);
        const M = isFinite(r.M) ? fmtPct(r.M) : '—';
        return `<tr><td>${m}</td><td style="text-align:right">${escHtml(I)}</td><td style="text-align:right">${escHtml(E)}</td><td style="text-align:right">${escHtml(U)}</td><td style="text-align:right">${escHtml(M)}</td></tr>`;
      }).join('');

      const tbl = `
        <div class="tblWrap" style="margin-top:10px;">
          <table class="tbl">
            <thead><tr><th>Mes</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Egresos</th><th style="text-align:right">Utilidad</th><th style="text-align:right">Margen</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">Sin datos para el año seleccionado.</td></tr>'}</tbody>
          </table>
        </div>`;

      return `<div class="kgrid">${k.join('')}</div>${tbl}`;
    })()}
  </div>

  <div class="card">
    <div class="h2">KPIs clave</div>
    ${kpisHTML}
  </div>

  <div class="pb"></div>

  <div class="card">
    <div class="h2">Egresos (Presupuesto vs Real)</div>
    ${pdfTable('E')}
  </div>

  <div style="height:12px"></div>

  <div class="card">
    <div class="h2">Ingresos (Esperado vs Real)</div>
    ${pdfTable('I')}
  </div>


  <div style="height:10px"></div>

  <div class="foot">Sugerencia: en el diálogo de impresión selecciona “Guardar como PDF”. Tamaño: Carta.</div>

</body></html>`;
      return html;
    }



    function downloadPDF(){
      // Reporte SOLO del mes seleccionado (si hay varios, toma el primero)
      const prevMes = new Set(FILTER_STATE.Mes);
      const months = Array.from(prevMes).map(norm).filter(Boolean).sort((a,b)=>a.localeCompare(b,'es'));
      const pick = months.length ? months[0] : null;
      if(!pick){
        alert('Selecciona un mes para generar el PDF.');
        return;
      }
      FILTER_STATE.Mes = new Set([pick]);

      const w = window.open('', '_blank');
      if(!w){
        // Si el navegador bloquea popups, avisa de forma clara
        alert('Tu navegador bloqueó la ventana emergente para el PDF. Permite popups para este sitio y vuelve a intentar.');
        FILTER_STATE.Mes = prevMes;
        return;
      }
      try{
        w.document.open();
        w.document.write(buildReportHTML());
        w.document.close();
        // Espera breve para render de SVG/fuentes
        setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 350);
      } finally {
        // Restaurar filtros en el dashboard
        FILTER_STATE.Mes = prevMes;
      }
    }