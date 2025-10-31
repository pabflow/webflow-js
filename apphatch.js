/* ===== Multistep Form (by Pablo Gubelin) =====
   Usa atributos:
   - data-form="multistep"  (wrapper)
   - data-form="step-1" ... "step-N"  (pasos, en orden DOM)
   - data-form="next-btn" / data-form="back-btn" (botones)
   Opcionales:
   - data-form="progress-bar"  (div cuya width% refleja progreso)
*/

(function () {
  const WIZ_SELECTOR = '[data-form="multistep"]';
  document.querySelectorAll(WIZ_SELECTOR).forEach(initWizard);

  function initWizard(wz) {
    const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
    if (!steps.length) return;

    let idx = 0;
    const total = steps.length;

    // Estado global simple para este wizard (aislado por instancia)
    wz.__STATE__ = wz.__STATE__ || { persons: [] };

    // Restaurar desde localStorage si existe
    const restored = loadState(wz);
    if (restored) wz.__STATE__ = Object.assign({ persons: [] }, restored);

    // Exponer para debug
    (window.__WIZARDS ||= []).push({ el: wz, STATE: wz.__STATE__ });

    // 1) Estado inicial antes de mostrar (anti-FOUC)
    steps.forEach((s, i) => {
      s.hidden = i !== idx;
    });
    showStep(idx);
    wz.classList.add("is-ready");
    try {
      const formId = wz.getAttribute("data-form-id") || "default";
      const raw = localStorage.getItem(`WZ_EDIT_REQUEST::${formId}`);
      if (raw) {
        localStorage.removeItem(`WZ_EDIT_REQUEST::${formId}`);
        const req = JSON.parse(raw) || {};
        if (typeof req.personIndex === "number") {
          // setear persona actual
          const s = wz.__STATE__ || (wz.__STATE__ = { persons: [] });
          const max = Math.max(0, (s.persons?.length || 1) - 1);
          s.curPerson = Math.max(0, Math.min(max, req.personIndex));

          // abrir Step-3 si existe
          const step3 = wz.querySelector('[data-form="step-3"]');
          if (step3) {
            const stepsArr = Array.from(
              wz.querySelectorAll('[data-form^="step-"]')
            );
            const idxS3 = stepsArr.indexOf(step3);
            if (idxS3 >= 0) {
              idx = idxS3; // ← usamos la variable idx ya declarada arriba
            }
          }
        }
      }
    } catch (e) {}

    // --- Helper: scroll al tope del step activo (o al top global si se pide) ---
    function scrollToStepTop(index, opts = {}) {
      const step = steps[index];
      if (!step) return;

      const offset =
        parseInt(wz.getAttribute("data-scroll-offset") || "0", 10) || 0;

      // Top absoluto (toda la página)
      if (
        (wz.getAttribute("data-scroll-target") || "").toLowerCase() === "window"
      ) {
        try {
          window.scrollTo({
            top: 0,
            behavior: opts.immediate ? "auto" : "smooth",
          });
        } catch {
          window.scrollTo(0, 0);
        }
        return;
      }

      // Top del step activo
      const y = step.getBoundingClientRect().top + window.pageYOffset - offset;
      try {
        window.scrollTo({
          top: y,
          behavior: opts.immediate ? "auto" : "smooth",
        });
      } catch {
        window.scrollTo(0, y);
      }

      // Reintento por si hubo relayout (imágenes, fuentes, Webflow)
      clearTimeout(scrollToStepTop._t);
      scrollToStepTop._t = setTimeout(() => {
        const y2 =
          step.getBoundingClientRect().top + window.pageYOffset - offset;
        try {
          window.scrollTo({ top: y2, behavior: "auto" });
        } catch {
          window.scrollTo(0, y2);
        }
      }, 120);
    }

    // Delegación de eventos Next/Back
    wz.addEventListener("click", (e) => {
      const nextBtn = e.target.closest('[data-form="next-btn"]');
      const backBtn = e.target.closest('[data-form="back-btn"]');

      if (nextBtn) {
        e.preventDefault();

        // Si el botón tiene data-next-href, redirigimos en vez de avanzar el wizard
        const url = nextBtn.getAttribute("data-next-href");
        if (url) {
          saveState(wz); // guarda el estado antes de salir
          window.location.assign(url);
          return;
        }

        // Comportamiento normal (seguir al próximo step del wizard)
        if (validateCurrentStep()) goTo(idx + 1);
      }
      if (backBtn) {
        e.preventDefault();
        goTo(idx - 1);
      }
    });

    // Enter para avanzar (menos en último step o textarea)
    wz.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const isLast = idx === total - 1;
        const isTextArea = e.target && e.target.tagName === "TEXTAREA";
        if (!isLast && !isTextArea) {
          e.preventDefault();
          if (validateCurrentStep()) goTo(idx + 1);
        }
      }
    });

    // Hook público
    wz.FormWizard = {
      goTo,
      next: () => goTo(idx + 1),
      back: () => goTo(idx - 1),
      current: () => idx,
      total: () => total,
    };

    function goTo(n) {
      const clamped = Math.max(0, Math.min(total - 1, n));
      if (clamped === idx) return;
      idx = clamped;

      showStep(idx);
      saveState(wz);

      // Scroll al top del step recién activado (espera 1 frame para layout)
      requestAnimationFrame(() => scrollToStepTop(idx));

      wz.dispatchEvent(
        new CustomEvent("form:stepchange", {
          detail: { stepIndex: idx, stepsTotal: total },
        })
      );
    }

    function showStep(activeIndex) {
      steps.forEach((step, i) => {
        const active = i === activeIndex;
        step.hidden = !active;
        step.setAttribute("aria-hidden", active ? "false" : "true");
      });
      const bar = wz.querySelector('[data-form="progress-bar"]');
      if (bar) {
        const pct = Math.round((activeIndex / (total - 1)) * 100);
        bar.style.width = `${pct}%`;
        bar.setAttribute("aria-valuenow", String(pct));
      }

      // Si entramos al Step-2, render dinámico de personas
      const step2 = wz.querySelector('[data-form="step-2"]');
      if (step2 && steps.indexOf(step2) === activeIndex) {
        renderPersonsForWizard(wz);
      }
    }

    // Validación extendida (incluye reglas específicas para Step-2)
    function validateCurrentStep() {
      const currentStep = steps[idx];

      // Validación nativa para inputs visibles
      const fields = currentStep.querySelectorAll("input, select, textarea");
      let firstInvalid = null;
      for (const field of fields) {
        if (field.disabled || isHidden(field)) continue;
        if (typeof field.reportValidity === "function") {
          if (!field.reportValidity() && !firstInvalid) firstInvalid = field;
        }
      }

      // Validación específica de Step-2
      const isStep2 = currentStep.matches('[data-form="step-2"]');
      if (isStep2) {
        const cards = Array.from(
          currentStep.querySelectorAll(
            '[data-form="persona-data"]:not(.is-template)'
          )
        );
        for (const card of cards) {
          // Nombre requerido
          const nameInput = card.querySelector(
            '[data-form="persona-name"], input[type="text"]'
          );
          if (nameInput) {
            if (!nameInput.value.trim()) {
              nameInput.setCustomValidity &&
                nameInput.setCustomValidity("Please add your name.");
              nameInput.reportValidity && nameInput.reportValidity();
              if (!firstInvalid) firstInvalid = nameInput;
              break;
            } else {
              nameInput.setCustomValidity && nameInput.setCustomValidity("");
            }
          }

          // Plan requerido
          let radioHolders = Array.from(
            card.querySelectorAll("[data-form_meal-plan]")
          );
          let radios = radioHolders
            .map(
              (h) =>
                (h.tagName === "INPUT"
                  ? h
                  : h.querySelector('input[type="radio"]')) || null
            )
            .filter(Boolean);
          if (!radios.length) {
            radios = Array.from(
              card.querySelectorAll('input[type="radio"][data-form_meal-plan]')
            );
          }
          const anyChecked = radios.some((r) => r.checked);
          if (!anyChecked) {
            const target = radios[0] || card;
            try {
              target.setCustomValidity &&
                target.setCustomValidity("Please Select a Plan.");
            } catch {}
            try {
              target.reportValidity && target.reportValidity();
            } catch {}
            if (typeof target.focus === "function")
              target.focus({ preventScroll: false });
            if (!firstInvalid) firstInvalid = target;
            break;
          } else {
            try {
              radios.forEach(
                (r) => r.setCustomValidity && r.setCustomValidity("")
              );
            } catch {}
          }
        }
      }

      if (firstInvalid) {
        wz.dispatchEvent(
          new CustomEvent("form:invalid", {
            detail: { stepIndex: idx, field: firstInvalid },
          })
        );
        return false;
      }
      return true;
    }

    function isHidden(el) {
      return el.offsetParent === null || el.closest("[hidden]");
    }
  }
})();

/* Quantity People control (Step 1) — min por defecto = 1
   Atributos esperados:
   - Botón decrement: [data-q_people-element="decrement"]  + aria-controls="#id-del-input"
   - Botón increment: [data-q_people-element="increment"]  + aria-controls="#id-del-input"
   - Input number:    [data-q_people-element="input"]      + id="..." (+ opcional min/max)
   - Inicial:         data-q_people-initial="(n)" en el input (opcional)
   - Display:         [data-form="total-people"] (se actualiza con el valor)
*/
(function () {
  const INPUT_SEL = '[data-q_people-element="input"]';
  const INC_SEL = '[data-q_people-element="increment"]';
  const DEC_SEL = '[data-q_people-element="decrement"]';
  const TOTAL_SEL = '[data-form="total-people"]';

  document.querySelectorAll(INPUT_SEL).forEach((input, idx) => {
    if (!input.id) input.id = `q-people-input-${idx + 1}`;

    const initAttr = input.getAttribute("data-q_people-initial");
    const init = isFinite(parseInt(initAttr, 10))
      ? parseInt(initAttr, 10)
      : parseInt(input.value || "1", 10) || 1; // 👈 default = 1

    const min = getMin(input),
      max = getMax(input);
    input.value = clamp(init, min, max);

    reflectTotal(input.value);
    updateMinusState(input);

    input.addEventListener("input", () => {
      const v = normalize(input.value);
      input.value = clamp(v, getMin(input), getMax(input));
      reflectTotal(input.value);
      updateMinusState(input);
      triggerStep2Rerender(input);
      saveState(input.closest('[data-form="multistep"]'));
    });

    input.addEventListener("change", () => {
      const v = normalize(input.value);
      input.value = clamp(v, getMin(input), getMax(input));
      reflectTotal(input.value);
      updateMinusState(input);
      triggerStep2Rerender(input);
      saveState(input.closest('[data-form="multistep"]'));
    });
  });

  function setupButton(btn, delta) {
    if (!btn) return;
    const targetId = (btn.getAttribute("aria-controls") || "").replace(
      /^#/,
      ""
    );
    let input = targetId ? document.getElementById(targetId) : null;
    if (!input)
      input = btn
        .closest('form, [data-form="multistep"], body')
        .querySelector(INPUT_SEL);
    if (!input) return;

    const act = () => {
      const min = getMin(input),
        max = getMax(input);
      const current = normalize(input.value);
      const next = clamp(current + delta, min, max);
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      reflectTotal(next);
      updateMinusState(input);
      triggerStep2Rerender(input);
      saveState(input.closest('[data-form="multistep"]'));
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      act();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        act();
      }
    });
  }

  document.querySelectorAll(INC_SEL).forEach((btn) => setupButton(btn, +1));
  document.querySelectorAll(DEC_SEL).forEach((btn) => setupButton(btn, -1));

  // Helpers

  function reflectTotal(value) {
    document.querySelectorAll(TOTAL_SEL).forEach((el) => {
      el.textContent = String(value);
    });
  }

  function normalize(v) {
    const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    return isFinite(n) ? n : 0;
  }

  function getMin(input) {
    return isFinite(parseInt(input.min, 10)) ? parseInt(input.min, 10) : 1; // 👈 default = 1
  }

  function getMax(input) {
    return isFinite(parseInt(input.max, 10)) ? parseInt(input.max, 10) : 9999;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function updateMinusState(input) {
    const min = getMin(input);
    const current = normalize(input.value);
    const decBtns = document.querySelectorAll(
      `[data-q_people-element="decrement"][aria-controls="#${input.id}"],
       [data-q_people-element="decrement"][aria-controls="${"#" + input.id}"]`
    );
    decBtns.forEach((b) => {
      const disabled = current <= min;
      b.setAttribute("aria-disabled", disabled ? "true" : "false");
      b.tabIndex = disabled ? -1 : 0;
      b.classList.toggle("is-disabled", disabled);
    });
  }

  function triggerStep2Rerender(input) {
    const wz = input.closest('[data-form="multistep"]');
    if (!wz) return;
    const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
    const step2 = wz.querySelector('[data-form="step-2"]');
    if (!step2) return;
    const isStep2 = steps.indexOf(step2) === wz.FormWizard.current();
    if (isStep2) {
      const n = parseInt(input.value, 10);
      const count = Number.isFinite(n) ? n : 1;
      window.dispatchEvent(
        new CustomEvent("__step2_rerender", { detail: { wz, step2, count } })
      );
    }
  }
})();

/* ===== Helpers ===== */
function parsePrice(v) {
  if (v == null) return null;
  // Soporta: "£1,299.50", "1.299,50", "1299,50", "1299.50", "£12/wk", etc.
  let s = String(v).trim();

  // Quitar cualquier símbolo que no sea dígito, punto, coma o signo -
  s = s.replace(/[^\d.,-]/g, "");

  // Si hay PUNTO y COMA a la vez, asumimos que la COMA es decimal y los PUNTOS son miles.
  if (s.includes(".") && s.includes(",")) {
    // quitar puntos de miles
    s = s.replace(/\./g, "");
    // usar coma como decimal → pasar a punto
    s = s.replace(/,/g, ".");
  } else {
    // Si solo hay comas, úsalas como decimal
    if (s.includes(",") && !s.includes(".")) {
      s = s.replace(/,/g, ".");
    }
    // Si hay múltiples puntos (miles), deja solo el último como decimal
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) {
      const last = s.lastIndexOf(".");
      s = s.slice(0, last).replace(/\./g, "") + s.slice(last);
    }
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Persistencia por wizard (usa data-form-id como key)
function getWizardKey(wz) {
  const id = wz.getAttribute("data-form-id") || "default";
  return `WZ_MEAL_APP_STATE::${id}`;
}

function saveState(wz) {
  try {
    const key = getWizardKey(wz);
    localStorage.setItem(key, JSON.stringify(wz.__STATE__ || {}));
  } catch (e) {}
}

function loadState(wz) {
  try {
    const key = getWizardKey(wz);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) {}
  return null;
}

/* ===== Step-2 personas dinámicas =====
   - Radios: data-form_meal-plan (en input o label/wrapper)
   - Usa SOLO data-plan-name para identidad
*/
(function () {
  const WZ_SEL = '[data-form="multistep"]';
  const STEP2_SEL = '[data-form="step-2"]';
  const Q_INPUT_SEL = '[data-q_people-element="input"]';
  const WRAP_SELECTOR = ".multi-form-meals_radio-icon"; // wrapper visual de Webflow
  const COMPLETED_COUNTER_SEL = '[data-form="people-completed"]'; // contador "X of Y"

  document.querySelectorAll(WZ_SEL).forEach((wz) => {
    wz.addEventListener("form:stepchange", (e) => {
      const stepIndex = e.detail?.stepIndex ?? null;
      const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
      const step2 = wz.querySelector(STEP2_SEL);
      if (step2 && steps.indexOf(step2) === stepIndex)
        renderPersonsForWizard(wz);
      // Actualizar contador al cambiar de paso (por si el elemento está fuera de Step-2)
      updatePeopleCompleted(wz);
    });

    document.addEventListener("DOMContentLoaded", () => {
      const step2 = wz.querySelector(STEP2_SEL);
      if (step2 && !step2.hidden) renderPersonsForWizard(wz);
      updatePeopleCompleted(wz);
    });
  });

  // Exponer render para live-sync desde Step-1
  window.renderPersonsForWizard = renderPersonsForWizard;

  /* ===== Helpers de contador (desde STATE, no DOM) ===== */
  function isPersonComplete(p) {
    return !!(p && p.name && p.name.trim() && p.plan && p.plan.name);
  }

  function updatePeopleCompleted(wz) {
    const S = wz.__STATE__ || { persons: [] };
    const count = Array.isArray(S.persons)
      ? S.persons.reduce((n, p) => n + (isPersonComplete(p) ? 1 : 0), 0)
      : 0;

    // Pintar en TODO el wizard, no solo Step-2
    wz.querySelectorAll(COMPLETED_COUNTER_SEL).forEach(
      (n) => (n.textContent = String(count))
    );

    // (Opcional) marcar cards completas si existen en Step-2
    const step2Root = wz.querySelector(STEP2_SEL);
    if (step2Root) {
      const cards = Array.from(
        step2Root.querySelectorAll(
          '[data-form="persona-list"] [data-form="persona-data"]:not(.is-template)'
        )
      );
      cards.forEach((card) => {
        const idx = parseInt(card.getAttribute("data-index"), 10);
        const complete = isPersonComplete((S.persons || [])[idx]);
        card.classList.toggle("is-complete", !!complete);
      });
    }
  }
  /* ===== Fin helpers contador ===== */

  function renderPersonsForWizard(wz) {
    const step2Root = wz.querySelector(STEP2_SEL);
    if (!step2Root) return;
    const qtyInput = wz.querySelector(Q_INPUT_SEL);
    const count = Math.max(
      1,
      Math.min(50, parseInt(qtyInput?.value || "1", 10) || 1)
    );

    const template = step2Root.querySelector('[data-form="persona-data"]');
    if (!template) {
      console.warn('Step-2: falta el template [data-form="persona-data"]');
      return;
    }

    let list = step2Root.querySelector('[data-form="persona-list"]');
    if (!list) {
      list = document.createElement("div");
      list.setAttribute("data-form", "persona-list");
      template.insertAdjacentElement("afterend", list);
    }

    const S = wz.__STATE__ || (wz.__STATE__ = { persons: [] });
    if (!Array.isArray(S.persons)) S.persons = [];

    // Ajustar tamaño del estado (sin prellenar nombres)
    while (S.persons.length < count)
      S.persons.push({ name: "", plan: null, planSize: null });
    if (S.persons.length > count) S.persons = S.persons.slice(0, count);

    list.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const data = S.persons[i];
      const card = template.cloneNode(true);
      card.classList.remove("is-template");
      card.style.display = "";
      card.removeAttribute("hidden");

      // Número visible
      const numEl = card.querySelector('[data-form="number-persona"]');
      if (numEl) numEl.textContent = String(i + 1);

      // Nombre (VACÍO por defecto + placeholder dinámico)
      const nameInput =
        card.querySelector('[data-form="persona-name"]') ||
        card.querySelector('input[type="text"]');
      const nameId = `person-${i + 1}-name`;
      if (nameInput) {
        nameInput.id = nameId;
        nameInput.name = `persons[${i}][name]`;
        nameInput.value = data?.name && data.name.trim() ? data.name : "";
        nameInput.placeholder = `Enter Name Person ${i + 1}`;

        const labelEl = nameInput.closest("label");
        if (labelEl) labelEl.setAttribute("for", nameId);

        // Guardar al escribir
        nameInput.addEventListener("input", () => {
          S.persons[i].name = nameInput.value.trim();
          saveState(wz);
          updatePeopleCompleted(wz); // ← actualiza contador
        });

        // Al enfocar: quitar placeholder
        nameInput.addEventListener("focus", () => {
          nameInput.placeholder = "";
        });

        // Al salir: restaurar placeholder si está vacío
        nameInput.addEventListener("blur", () => {
          if (!nameInput.value.trim()) {
            nameInput.placeholder = `Enter Name Person ${i + 1}`;
          }
        });
      }

      // ===== Radios =====
      const radioGroupName = `persons[${i}][plan_choice]`;
      const holders = Array.from(
        card.querySelectorAll("[data-form_meal-plan]")
      );
      let radios = holders
        .map(
          (h) =>
            (h.tagName === "INPUT"
              ? h
              : h.querySelector('input[type="radio"]')) || null
        )
        .filter(Boolean);
      if (!radios.length)
        radios = Array.from(
          card.querySelectorAll('input[type="radio"][data-form_meal-plan]')
        );
      radios.forEach((r) => {
        r.name = radioGroupName;
      });

      // Helpers UI (wrapper puede ser ancestro, hermano o hijo)
      const getWrapper = (r) => {
        return (
          r.closest(WRAP_SELECTOR) ||
          r.parentElement?.querySelector(WRAP_SELECTOR) ||
          (r.nextElementSibling && r.nextElementSibling.matches?.(WRAP_SELECTOR)
            ? r.nextElementSibling
            : null)
        );
      };
      const clearWrapperChecked = () => {
        radios.forEach((r) => {
          const wrap = getWrapper(r);
          if (wrap) {
            wrap.classList.remove("w--redirected-checked");
            wrap.setAttribute("aria-checked", "false");
          }
        });
      };
      const markWrapperChecked = (r) => {
        const wrap = getWrapper(r);
        if (wrap) {
          wrap.classList.add("w--redirected-checked");
          wrap.setAttribute("aria-checked", "true");
        }
      };

      // Attr helpers
      const getAttr = (r, name) => {
        const holder = r.closest("[data-form_meal-plan]") || r;
        return (holder.getAttribute(name) || r.getAttribute(name) || "").trim();
      };
      const norm = (s) => (s || "").trim().toLowerCase();

      // Preselección por nombre (sin auto-select)
      let preChecked = null;
      if (data?.plan?.name) {
        const savedNameNorm = norm(data.plan.name);
        const match = radios.find(
          (r) => norm(getAttr(r, "data-plan-name")) === savedNameNorm
        );
        if (match) {
          match.checked = true;
          preChecked = match;
        }
      }

      // Guardar y actualizar contador al cambiar
      radios.forEach((r) => {
        r.addEventListener("change", () => {
          if (!r.checked) return;
          const planName = getAttr(r, "data-plan-name");
          const sizeRaw = getAttr(r, "data-plan-size");
          const priceRaw = getAttr(r, "data-plan-price");
          const sizeNum = parseInt(sizeRaw, 10);
          const priceNum = parsePrice(priceRaw);

          clearWrapperChecked();
          markWrapperChecked(r);

          S.persons[i].plan = {
            name: planName || null,
            size: Number.isFinite(sizeNum) ? sizeNum : null,
            price: Number.isFinite(priceNum) ? priceNum : null,
          };
          if (Number.isFinite(sizeNum)) S.persons[i].planSize = sizeNum;

          saveState(wz);
          updatePeopleCompleted(wz); // ← actualiza contador
        });
      });

      // Rehidratar UI (volver de otro paso)
      if (preChecked) {
        preChecked.dispatchEvent(new Event("change", { bubbles: true }));
        clearWrapperChecked();
        markWrapperChecked(preChecked);
        setTimeout(() => {
          clearWrapperChecked();
          markWrapperChecked(preChecked);
          updatePeopleCompleted(wz);
        }, 0);
      } else {
        clearWrapperChecked();
      }

      card.setAttribute("data-index", String(i));
      list.appendChild(card);
    }

    // Snapshot del step + contador
    saveState(wz);
    updatePeopleCompleted(wz);
  }
})();

/* =========================
   STEP-3 — Core + Order Alert
   ========================= */
(function () {
  const WZ_SEL = '[data-form="multistep"]';
  const STEP3_SEL = '[data-form="step-3"]';

  // Personas header (selector duplicable)
  const PERSONAS_WRAP = '[data-form="personas-wrap"]';
  const PERSONA_TMPL = '[data-form="persona-selector"].is-template';
  const PERSONA_ITEM = '[data-form="persona-selector"]:not(.is-template)';
  const ARROW_TMPL = '[data-form="arrow"].is-template';

  // 👉 mostrará siempre el nombre de la persona actual en el cart/encabezados
  const CURRENT_PERSONA = '[data-form="current-persona"]';

  // Grid (cada plato)
  const ROW_SEL = "[data-meal-id][data-meal-name]";
  const INP_SEL = '[data-meal-element="input"]';
  const INC_SEL = '[data-meal-element="increment"]';
  const DEC_SEL = '[data-meal-element="decrement"]';
  const CB_SEL = ".meals_checkbox";

  // Personas UI
  const LIST_SEL = '[data-form="persona-meals-list"]';
  const CARD_TMPL = '[data-form="persona-meals"].is-template';
  const CARD_NAMESEL = '[data-form="persona-name"]';
  const NEXT_BTNSEL = '[data-form="persona-next"]'; // Continue to Next Selection →
  const PREV_BTNSEL = '[data-form="persona-prev"]';
  const STEP_NEXTSEL = '[data-form="next-btn"]'; // Continue to Last Step
  const BUTTONS_WRAP = '[data-form="buttons"]';
  const NEXT_PERSON_LABEL_SEL = '[data-form="persona-label"]';

  // Cart
  const CART_SEL = '[data-form="cart"]';
  const ORDER_WRAP_SEL = '[data-form="order-general"]';
  const PRICE_ITEM_TPL = '[data-form="price-item"]';
  const ITEM_MEAL_TPL = '[data-form="item-meal"]';
  const TOTAL_PRICE_SEL = '[data-form="total-price"]';

  // Progreso + copys
  const SEL_COUNT = '[data-form="number-meals-selected"]';
  const PLAN_TOTAL = '[data-form="meals-total-plan"]';
  const BAR = '[data-form="background-bar"] [data-form="active-bar"]';
  const TITLE_SEL = '[data-form="person-title"]';
  const SUBTITLE_SEL = '[data-form="person-subtitle"]';
  const HEADER_NAME = '[data-form="persona-name"]';

  // Modal (order-alert)
  const ALERT_SEL = '[data-form="order-alert"]';
  const ALERT_TITLE_NUM =
    '[data-form="order-title"] [data-form="number-meals-selected"]';
  const ALERT_SUB_SPAN = '[data-form="order-text-subtraction"]';
  const ALERT_NEXT_NUM = '[data-form="order-next-plan-number"]';
  const ALERT_NEXT_DIFF =
    '[data-form="order-next-plan-price"], [data-form="order-text-nextplan-diff"]';
  const ALERT_BTN_KEEP = '[data-form="order-keep-plan"]';
  const ALERT_BTN_UPGRADE = '[data-form="order-next-plan"]';

  // ===== helpers de estado =====
  const S = (wz) => (wz.__STATE__ ||= { persons: [] });
  const curI = (wz) => {
    const s = S(wz);
    s.curPerson = Math.max(
      0,
      Math.min((s.persons?.length || 1) - 1, s.curPerson | 0)
    );
    return s.curPerson | 0;
  };
  const setCur = (wz, i) => {
    S(wz).curPerson = i;
    saveState(wz);
  };
  const ensureMeals = (p) =>
    p.meals && typeof p.meals === "object" ? p.meals : (p.meals = {});
  const pname = (p, i) =>
    p?.name && p.name.trim() ? p.name.trim() : `Person ${i + 1}`;
  const countMeals = (p) =>
    Object.values(p?.meals || {}).reduce(
      (n, e) => n + (parseInt(e?.qty, 10) || 0),
      0
    );
  const fmtGBP = (n) => {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(n || 0);
    } catch {
      return "£" + Number(n || 0).toFixed(2);
    }
  };

  // 👉 NUEVO: sincroniza todos los [data-form="current-persona"] con el nombre actual
  function updateCurrentPersona(wz) {
    const step3 = wz.querySelector(STEP3_SEL) || wz;
    const s = S(wz);
    const i = curI(wz);
    const p = s.persons[i] || {};
    const name = pname(p, i);

    step3.querySelectorAll(CURRENT_PERSONA).forEach((el) => {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        if (el.value !== name) {
          el.value = name;
          // eventos para que Webflow/otros bindings reaccionen
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        el.textContent = name;
      }
      el.setAttribute("data-person-index", String(i));
    });
  }

  // Lee todas las opciones de plan disponibles desde los radios del Step-2 del mismo wizard
  function getAllPlanSizes(wz) {
    const set = new Set();
    wz.querySelectorAll("[data-form_meal-plan]").forEach((n) => {
      const holder = n.closest("[data-form_meal-plan]") || n;
      const sz = parseInt(
        holder.getAttribute("data-plan-size") ||
          n.getAttribute("data-plan-size") ||
          "",
        10
      );
      if (Number.isFinite(sz)) set.add(sz);
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  function findPlanMetaBySize(wz, size) {
    if (!size) return null;
    let meta = null;
    wz.querySelectorAll("[data-form_meal-plan]").forEach((n) => {
      const holder = n.closest("[data-form_meal-plan]") || n;
      const sz = parseInt(
        holder.getAttribute("data-plan-size") ||
          n.getAttribute("data-plan-size") ||
          "",
        10
      );
      if (sz === size && !meta) {
        const name =
          (
            holder.getAttribute("data-plan-name") ||
            n.getAttribute("data-plan-name") ||
            ""
          ).trim() || `${size} meal plan`;
        const priceRaw = (
          holder.getAttribute("data-plan-price") ||
          n.getAttribute("data-plan-price") ||
          ""
        ).trim();
        const price = parseFloat((priceRaw || "").replace(/[^\d.]/g, ""));
        meta = { size, name, price: Number.isFinite(price) ? price : null };
      }
    });
    return meta || { size, name: `${size} meal plan`, price: null };
  }

  function nextPlanSizeForDesired(wz, currentSize, desiredTotal) {
    const sizes = getAllPlanSizes(wz);
    const target = Math.max(currentSize || 0, desiredTotal || 0);
    return sizes.find((sz) => sz >= target) || null;
  }

  // ===== montaje principal =====
  document.querySelectorAll(WZ_SEL).forEach((wz) => {
    wz.addEventListener("form:stepchange", (e) => {
      const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
      const step3 = wz.querySelector(STEP3_SEL);
      if (!step3) return;
      const on = steps.indexOf(step3) === (e.detail?.stepIndex ?? -1);
      if (!on) return;
      mountStep3(wz);
    });
    // por si ya está visible al cargar
    const step3 = wz.querySelector(STEP3_SEL);
    if (step3 && !step3.hidden) mountStep3(wz);
  });

  function mountStep3(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const s = S(wz);
    if (!Array.isArray(s.persons) || !s.persons.length)
      s.persons = [
        {
          name: "Person 1",
          plan: null,
          meals: {},
        },
      ];

    // 1) Pintar cards de personas
    const list = step3.querySelector(LIST_SEL);
    const tmpl = step3.querySelector(CARD_TMPL);
    if (list && tmpl) {
      list.innerHTML = "";
      s.persons.forEach((p, i) => {
        const card = tmpl.cloneNode(true);
        card.classList.remove("is-template");
        card.hidden = false;
        card.setAttribute("data-person-index", String(i));
        const nameEl = card.querySelector(CARD_NAMESEL);
        if (nameEl) nameEl.textContent = pname(p, i);
        list.appendChild(card);
      });
    }

    // 2) Mostrar solo persona actual
    showOnly(wz, curI(wz));

    // 3) Bindings
    bindNavOnce(wz);
    bindGridOnce(wz);
    bindAlertOnce(wz);

    // 4) Rehidratar y nav
    rehydrateAll(wz);
    updateNavButtons(wz);
  }

  // ---- navegación ----
  function bindNavOnce(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    if (step3.__navBound) return;
    step3.__navBound = true;

    step3.addEventListener(
      "click",
      (e) => {
        const next = e.target.closest?.(NEXT_BTNSEL);
        const prev = e.target.closest?.(PREV_BTNSEL);
        if (!next && !prev) return;
        e.preventDefault();
        const s = S(wz);
        if (next && curI(wz) < s.persons.length - 1) setCur(wz, curI(wz) + 1);
        if (prev && curI(wz) > 0) setCur(wz, curI(wz) - 1);
        showOnly(wz, curI(wz));
        rehydrateAll(wz);
        updateNavButtons(wz);
        scrollTopStep3(wz); // feedback: siempre subir
      },
      true
    );
  }

  function updateNavButtons(wz) {
    const step3 = wz.querySelector('[data-form="step-3"]');
    const s = (wz.__STATE__ ||= { persons: [] });
    const total = s.persons.length || 1;

    // persona actual
    const i = (function curI() {
      s.curPerson = Math.max(
        0,
        Math.min((s.persons?.length || 1) - 1, s.curPerson | 0)
      );
      return s.curPerson | 0;
    })();

    const isLast = i >= total - 1;
    const single = total <= 1;

    // estado de "completado" para la persona actual
    const p = s.persons[i] || {};
    const planTotal = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
    const selected = Object.values(p?.meals || {}).reduce(
      (n, e) => n + (parseInt(e?.qty, 10) || 0),
      0
    );
    const completed = planTotal > 0 && selected >= planTotal;

    // Botón "Continuar a la siguiente persona" (solo si hay otra persona Y está completo)
    const NEXT_BTNSEL = '[data-form="persona-next"]';
    step3.querySelectorAll(NEXT_BTNSEL).forEach((btn) => {
      const showNext = !single && !isLast && completed;
      btn.style.display = showNext ? "" : "none";

      // etiqueta accesible con el nombre de la próxima persona
      const nextIndex = i + 1;
      const nextName =
        s.persons[nextIndex] &&
        (s.persons[nextIndex].name?.trim() || `Person ${nextIndex + 1}`);
      if (showNext && nextName) {
        const label = btn.querySelector('[data-form="persona-label"]');
        if (label) label.textContent = nextName;
        btn.setAttribute("aria-label", `Continue to ${nextName} selection`);
      }
    });

    // Botón "Continuar al último paso" (tu [data-form="next-btn"] con data-next-href)
    const STEP_NEXTSEL = '[data-form="next-btn"]';
    step3.querySelectorAll(STEP_NEXTSEL).forEach((btn) => {
      // si es el que redirige (tiene data-next-href), aplicá la regla estricta:
      const isRedirect = btn.hasAttribute("data-next-href");
      if (isRedirect) {
        const show = completed && (single || isLast);
        btn.style.display = show ? "" : "none";
        btn.toggleAttribute("aria-disabled", !show);
      } else {
        // Para cualquier otro "next-btn" interno (si existiera), lo ocultamos mientras NO esté completo
        const show = completed && (single || isLast);
        btn.style.display = show ? "" : "none";
        btn.toggleAttribute("aria-disabled", !show);
      }
    });
  }

  function showOnly(wz, index) {
    wz.querySelectorAll(
      `${STEP3_SEL} [data-form="persona-meals"]:not(.is-template)`
    ).forEach((c, idx) => (c.hidden = idx !== index));
  }

  function scrollTopStep3(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const top = step3.getBoundingClientRect().top + window.pageYOffset - 24;
    try {
      window.scrollTo({ top, behavior: "smooth" });
    } catch {
      window.scrollTo(0, top);
    }
  }

  function scrollDownToCart(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const cart = step3.querySelector(CART_SEL) || step3;
    const y = cart.getBoundingClientRect().top + window.pageYOffset - 16;
    try {
      window.scrollTo({ top: y, behavior: "smooth" });
    } catch {
      window.scrollTo(0, y);
    }
  }

  // ---- grilla ----
  function bindGridOnce(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    if (step3.__gridBound) return;
    step3.__gridBound = true;

    // + / -
    step3.addEventListener(
      "click",
      (e) => {
        const plus = e.target.closest?.(INC_SEL);
        const minus = e.target.closest?.(DEC_SEL);
        if (!plus && !minus) return;
        const row = e.target.closest(ROW_SEL);
        if (!row) return;
        e.preventDefault();
        const input = row.querySelector(INP_SEL);
        const current = parseInt(input?.value || "0", 10) || 0;
        const desired = current + (plus ? 1 : -1);
        setRowQty(wz, row, desired, true);
      },
      true
    );

    // input manual
    step3.addEventListener(
      "input",
      (e) => {
        const inp = e.target.closest?.(INP_SEL);
        if (!inp) return;
        const row = inp.closest(ROW_SEL);
        if (!row) return;
        setRowQty(wz, row, inp.value, true);
      },
      true
    );

    // checkbox
    step3.addEventListener(
      "change",
      (e) => {
        const cb = e.target.closest?.(CB_SEL);
        if (!cb) return;
        const row = cb.closest(ROW_SEL);
        if (!row) return;
        setRowQty(wz, row, cb.checked ? 1 : 0, true);
      },
      true
    );
  }

  function setRowQty(wz, row, qtyLike, enforceCap) {
    const s = S(wz);
    const i = curI(wz);
    const p = s.persons[i] || (s.persons[i] = {});
    const meals = ensureMeals(p);

    const mealId = row.getAttribute("data-meal-id") || "";
    const mealName = row.getAttribute("data-meal-name") || mealId;

    const input = row.querySelector(INP_SEL);
    const cb = row.querySelector(CB_SEL);

    let desired = Math.max(
      0,
      parseInt(String(qtyLike).replace(/[^\d-]/g, ""), 10) || 0
    );
    let clamped = false;
    let attemptedExtra = 0;

    if (enforceCap) {
      const cap = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
      if (cap > 0) {
        const selectedWithoutThis = Math.max(
          0,
          countMeals(p) - (meals[mealId]?.qty || 0)
        );
        const remaining = Math.max(0, cap - selectedWithoutThis);
        if (desired > remaining) {
          attemptedExtra = desired - remaining;
          desired = remaining;
          clamped = true;
        }
      }
    }

    if (desired > 0) meals[mealId] = { name: mealName, qty: desired };
    else delete meals[mealId];

    if (input) input.value = String(desired);
    if (cb) cb.checked = desired > 0;

    saveState(wz);
    renderCart(wz);
    renderProgressAndCopies(wz);

    if (clamped) {
      bounce(row);
      showOrderAlert(wz, { attemptedExtra: Math.max(1, attemptedExtra) });
      return; // ⛔ no auto-advance si intentó pasarse del cupo
    }

    maybeHideOrderAlert(wz);

    // 👇 NUEVO: si justo completó su cupo, avanza suave a la siguiente persona
    maybeAutoAdvance(wz, { delay: 700 });
  }

  // Helper: avanza automáticamente a la siguiente persona cuando completa su cupo
  function maybeAutoAdvance(wz, { delay = 700 } = {}) {
    const s = S(wz);
    const i = curI(wz);
    const p = s.persons[i] || {};
    const cap = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
    const selected = countMeals(p);

    // ⛔ Por defecto, NO auto-avanza (solo si pones data-auto-advance="true" en el wrapper)
    if ((wz.getAttribute("data-auto-advance") || "").toLowerCase() !== "true")
      return;

    // Si no está completo, resetea flag y nada más
    if (!cap || selected !== cap) {
      if (p.__aaDone) {
        delete p.__aaDone;
        saveState(wz);
      }
      return;
    }

    // Evitar disparos múltiples para la misma persona
    if (p.__aaDone) return;
    p.__aaDone = true;
    saveState(wz);

    const next = i + 1;
    if (next < (s.persons?.length || 0)) {
      setTimeout(() => {
        setCur(wz, next);
        showOnly(wz, curI(wz));
        rehydrateAll(wz);
        updateNavButtons(wz);
        scrollTopStep3(wz);
      }, delay);
    } else {
      // Última persona: quedate en el mismo step (o si querés, acá podrías ir al próximo step)
      // if ((wz.getAttribute('data-auto-next')||'').toLowerCase()==='true' && wz.FormWizard) wz.FormWizard.next();
    }
  }

  function bounce(el) {
    if (!el) return;
    el.classList.remove("shake-limit");
    void el.offsetWidth;
    el.classList.add("shake-limit");
    setTimeout(() => el.classList.remove("shake-limit"), 450);
  }

  // ---- rehidratación completa ----
  function rehydrateAll(wz) {
    syncGridFromState(wz);
    renderCart(wz);
    renderProgressAndCopies(wz);
    updateCurrentPersona(wz); // 👉 NUEVO
    maybeHideOrderAlert(wz);
  }

  function syncGridFromState(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const s = S(wz);
    const p = s.persons[curI(wz)] || {};
    const meals = ensureMeals(p);
    step3.querySelectorAll(ROW_SEL).forEach((row) => {
      const id = row.getAttribute("data-meal-id") || "";
      const entry = id ? meals[id] : null;
      const qty = Math.max(0, parseInt(entry?.qty || 0, 10) || 0);
      const input = row.querySelector(INP_SEL);
      const cb = row.querySelector(CB_SEL);
      if (input) input.value = String(qty);
      if (cb) cb.checked = qty > 0;
    });
  }

  // ---- cart ----
  function renderCart(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const order = step3.querySelector(ORDER_WRAP_SEL);
    if (!order) return;

    const s = S(wz);
    const persons = s.persons || [];
    const priceTpl =
      order.querySelector(`${PRICE_ITEM_TPL}.is-template`) ||
      order.querySelector(PRICE_ITEM_TPL);
    const itemTpl =
      order.querySelector(`${ITEM_MEAL_TPL}.is-template`) ||
      order.querySelector(ITEM_MEAL_TPL);

    order
      .querySelectorAll(`${PRICE_ITEM_TPL}:not(.is-template)`)
      .forEach((n) => n.remove());
    order
      .querySelectorAll(`${ITEM_MEAL_TPL}:not(.is-template)`)
      .forEach((n) => n.remove());

    let after = priceTpl || itemTpl || order;
    let totalPlans = 0;

    persons.forEach((p, i) => {
      const planSize = Number.isFinite(p?.plan?.size) ? p.plan.size : null;
      const planName =
        p?.plan?.name && p.plan.name.trim()
          ? p.plan.name.trim()
          : planSize
          ? `${planSize} meal plan`
          : "Meal plan";
      const planPrice = Number(p?.plan?.price) || 0;
      totalPlans += planPrice;

      if (priceTpl) {
        const node = priceTpl.cloneNode(true);
        node.classList.remove("is-template");
        node.hidden = false;
        node.style.display = "";
        node.setAttribute("data-person-index", String(i));
        const badge = node.querySelector('[data-form="person-label"]');
        const planEl = node.querySelector('[data-form="meal-plan"]');
        const priceEl = node.querySelector('[data-form="price"]');
        if (badge) badge.textContent = pname(p, i);
        if (planEl) planEl.textContent = planName;
        if (priceEl) priceEl.textContent = fmtGBP(planPrice);
        after.insertAdjacentElement("afterend", node);
        after = node;
      }

      const meals = ensureMeals(p);
      if (itemTpl) {
        Object.keys(meals).forEach((id) => {
          const { name, qty } = meals[id] || {};
          const q = parseInt(qty, 10) || 0;
          if (!q) return;
          const node = itemTpl.cloneNode(true);
          node.classList.remove("is-template");
          node.hidden = false;
          node.style.display = "";
          const badge = node.querySelector('[data-form="person-label"]');
          const nameEl = node.querySelector('[data-form="meal-plan"]');
          const qtyEl = node.querySelector('[data-form="quantity"]');
          if (badge) badge.textContent = pname(p, i);
          if (nameEl) nameEl.textContent = name || id;
          if (qtyEl) qtyEl.textContent = String(q);
          after.insertAdjacentElement("afterend", node);
          after = node;
        });
      }
    });

    const totalEl = order.querySelector(TOTAL_PRICE_SEL);
    if (totalEl) totalEl.textContent = fmtGBP(totalPlans);

    updateCurrentPersona(wz); // 👉 NUEVO
  }

  // ==== ayudas para el label de progreso ====
  function findProgressLabelContainers(root) {
    const out = new Set();

    // 1) Ya marcados previamente
    root.querySelectorAll("[data-progress-label]").forEach((el) => out.add(el));

    // 2) Descubrir nuevos por los spans y marcarlos
    root
      .querySelectorAll('[data-form="number-meals-selected"]')
      .forEach((span) => {
        let el = span,
          container = null;
        while (el && el !== root) {
          if (
            el.querySelector &&
            el.querySelector('[data-form="meals-total-plan"]')
          ) {
            container = el;
            break;
          }
          el = el.parentElement;
        }
        if (!container) return;

        // Debe convivir con una barra de progreso en su zona
        let n = container,
          hasBar = false;
        while (n && n !== root) {
          if (
            n.querySelector &&
            n.querySelector('[data-form="background-bar"]')
          ) {
            hasBar = true;
            break;
          }
          n = n.parentElement;
        }
        if (hasBar) {
          container.setAttribute("data-progress-label", ""); // <- marcar para próximas veces
          out.add(container);
        }
      });

    return Array.from(out);
  }

  // Cambia mensaje y oculta/muestra la barra según esté completo
  function toggleCompletionUI(wz, selected, planTotal) {
    const step3 = wz.querySelector('[data-form="step-3"]') || wz;
    const completed = planTotal > 0 && selected >= planTotal;

    // Ocultar/mostrar TODAS las barras
    step3.querySelectorAll('[data-form="background-bar"]').forEach((bg) => {
      bg.style.display = completed ? "none" : "";
    });

    // Texto (X out of X...) ↔ Yay!
    const labels = findProgressLabelContainers(step3);
    labels.forEach((label) => {
      // aseguramos que quede marcado aunque venga de un HTML viejo
      label.setAttribute("data-progress-label", "");

      if (completed) {
        if (!label.__origHTML) label.__origHTML = label.innerHTML; // guardar original una vez
        label.textContent = "🎉Yay! Your selection is completed!✅";
      } else {
        // restaurar el original o reconstruir spans si no hay backup
        if (label.__origHTML) {
          label.innerHTML = label.__origHTML;
        } else {
          label.innerHTML =
            '<span data-form="number-meals-selected"></span> out of ' +
            '<span data-form="meals-total-plan"></span> meals selected';
        }
        // volver a pintar los números
        label
          .querySelectorAll('[data-form="number-meals-selected"]')
          .forEach((el) => {
            el.textContent = String(selected);
          });
        label
          .querySelectorAll('[data-form="meals-total-plan"]')
          .forEach((el) => {
            el.textContent = String(planTotal);
          });
      }
    });
  }

  // ---- progreso + copys ----
  function renderProgressAndCopies(wz) {
    const s = S(wz);
    const i = curI(wz);
    const p = s.persons[i] || {};
    const selected = countMeals(p);
    const planTotal = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
    // Mostrar el wrapper de botones solo si el cupo está completo
    const completed = planTotal > 0 && selected >= planTotal;
    const step3 = wz.querySelector(STEP3_SEL) || wz;
    step3.querySelectorAll(BUTTONS_WRAP).forEach((wrap) => {
      wrap.style.display = completed ? "" : "none";
    });

    // Actualizar cuál de los dos botones se ve
    updateNavButtons(wz);

    // Contadores
    wz.querySelectorAll(SEL_COUNT).forEach(
      (el) => (el.textContent = String(selected))
    );
    wz.querySelectorAll(PLAN_TOTAL).forEach(
      (el) => (el.textContent = String(planTotal))
    );

    // Barra
    const bar = wz.querySelector(BAR);
    if (bar) {
      const pct =
        planTotal > 0
          ? Math.min(100, Math.round((selected / planTotal) * 100))
          : 0;
      bar.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(pct));
    }

    // Copys por persona
    const name = pname(p, i);
    wz.querySelectorAll(TITLE_SEL).forEach((el) => {
      el.textContent = `Choose ${name} Meals`;
    });
    wz.querySelectorAll(SUBTITLE_SEL).forEach((el) => {
      el.textContent = planTotal
        ? `Select ${planTotal} meals from our menu`
        : "Select meals from our menu";
    });
    wz.querySelectorAll(HEADER_NAME).forEach((el) => {
      el.textContent = name;
    });

    // 👉 nuevo: UI de completado + persona actual
    toggleCompletionUI(wz, selected, planTotal);
    updateCurrentPersona(wz);
  }

  // ---- order alert ----
  function bindAlertOnce(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    if (wz.__alertBound) return; // usamos una marca en el wizard (no en step3)
    wz.__alertBound = true;

    const onClick = (e) => {
      const alertEl = e.target.closest(ALERT_SEL);
      if (!alertEl) return; // ignora clicks fuera del popup

      const keep = e.target.closest(ALERT_BTN_KEEP);
      const upg = e.target.closest(ALERT_BTN_UPGRADE);
      if (!keep && !upg) return;

      e.preventDefault();

      if (keep) {
        setAlertVisible(step3, false);
        setTimeout(() => scrollDownToCart(wz), 60);
        return;
      }

      // --- Upgrade ---
      const s = S(wz);
      const i = curI(wz);
      const p = s.persons[i] || {};
      const curSize = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
      const selected = countMeals(p);

      // 1) intenta usar el número mostrado en el popup
      let shownNext = parseInt(
        (alertEl.querySelector(ALERT_NEXT_NUM)?.textContent || "").trim(),
        10
      );
      if (!Number.isFinite(shownNext)) shownNext = null;

      // 2) fallback: siguiente plan que soporte al menos (selected + 1)
      const computedNext = nextPlanSizeForDesired(
        wz,
        curSize,
        Math.max(selected + 1, curSize + 1)
      );
      const nextSize = shownNext || computedNext;

      if (!nextSize || nextSize <= curSize) {
        setAlertVisible(step3, false);
        return;
      }

      const meta = findPlanMetaBySize(wz, nextSize);
      p.plan = {
        name: meta.name,
        size: meta.size,
        price: meta.price ?? p.plan?.price,
      };

      saveState(wz);
      renderCart(wz);
      renderProgressAndCopies(wz);
      setAlertVisible(step3, false);
      setTimeout(() => scrollDownToCart(wz), 120);
      updateNavButtons(wz);
    };

    // Escucha global para capturar el overlay aunque esté fuera de step-3
    document.addEventListener("click", onClick, true);
  }

  function setAlertVisible(step3, visible) {
    const alert =
      step3.querySelector(ALERT_SEL) || document.querySelector(ALERT_SEL);
    if (!alert) return;
    if (visible) {
      alert.removeAttribute("hidden");
      alert.setAttribute("aria-hidden", "false");
      alert.classList.add("is-open");
      alert.style.display = "flex";
      alert.style.visibility = "visible";
      alert.style.opacity = "1";
    } else {
      alert.setAttribute("hidden", "");
      alert.setAttribute("aria-hidden", "true");
      alert.classList.remove("is-open");
      alert.style.display = "none";
      alert.style.visibility = "hidden";
      alert.style.opacity = "0";
    }
  }

  function showOrderAlert(wz, { attemptedExtra = 1 } = {}) {
    const step3 = wz.querySelector(STEP3_SEL);
    const alert =
      step3.querySelector(ALERT_SEL) || document.querySelector(ALERT_SEL);
    if (!alert) return;

    const s = S(wz);
    const i = curI(wz);
    const p = s.persons[i] || {};
    const selected = countMeals(p);
    const planTotal = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;

    // Números
    alert
      .querySelectorAll(ALERT_TITLE_NUM)
      .forEach((n) => (n.textContent = String(selected)));
    alert
      .querySelectorAll(PLAN_TOTAL)
      .forEach((n) => (n.textContent = String(planTotal)));
    alert
      .querySelectorAll(ALERT_SUB_SPAN)
      .forEach((n) => (n.textContent = String(attemptedExtra)));

    // Próximo plan posible + label Keep + diferencia con signo
    const nextSize = nextPlanSizeForDesired(
      wz,
      planTotal,
      selected + attemptedExtra
    );
    if (!nextSize) {
      setAlertVisible(step3, false);
      return;
    }
    alert
      .querySelectorAll(ALERT_NEXT_NUM)
      .forEach((n) => (n.textContent = nextSize ? String(nextSize) : ""));

    // --- "Keep <PLAN ACTUAL>" ---
    (function setKeepLabel() {
      const size = Number.isFinite(p?.plan?.size) ? p.plan.size : null;
      const planName =
        p?.plan?.name && p.plan.name.trim()
          ? p.plan.name.trim()
          : size
          ? `${size} meal plan`
          : "Meal plan";

      const keepBtn = alert.querySelector(ALERT_BTN_KEEP);
      if (!keepBtn) return;

      // Si el botón tiene <span data-form="meal-plan"> lo rellenamos; si no, aria-label
      const span = keepBtn.querySelector('[data-form="meal-plan"]');
      if (span) {
        span.textContent = planName;
      } else if (!keepBtn.getAttribute("aria-label")) {
        keepBtn.setAttribute("aria-label", `Keep ${planName}`);
      }
    })();

    // --- Diferencia de precio con + / − (soporta span y literal "(diff)")
    let diffTxt = "";
    {
      const nextMeta = findPlanMetaBySize(wz, nextSize);
      const nextPrice = nextMeta?.price ?? null;
      const curPrice = p?.plan?.price ?? null;

      if (isFinite(nextPrice) && isFinite(curPrice) && nextPrice !== curPrice) {
        const diff = nextPrice - curPrice;
        const sign = diff > 0 ? "+" : "−";
        diffTxt = `(${sign}${fmtGBP(Math.abs(diff))})`;
      }
    }

    // 1) Actualiza todos los spans de diff compatibles
    alert.querySelectorAll(ALERT_NEXT_DIFF).forEach((el) => {
      el.textContent = diffTxt;
    });

    // 2) Además, si el botón tiene el literal "(diff)" como texto plano, reemplazarlo
    const btnUpg = alert.querySelector(ALERT_BTN_UPGRADE);
    if (btnUpg) {
      const walker = document.createTreeWalker(
        btnUpg,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while ((node = walker.nextNode())) {
        if (/\(diff\)/i.test(node.nodeValue || "")) {
          node.nodeValue = node.nodeValue.replace(/\(diff\)/gi, diffTxt || "");
        }
      }

      const hasSpan = !!btnUpg.querySelector(
        '[data-form="order-next-plan-price"], [data-form="order-text-nextplan-diff"]'
      );
      if (!hasSpan && diffTxt) {
        const span = document.createElement("span");
        span.setAttribute("data-form", "order-text-nextplan-diff");
        span.textContent = diffTxt;
        btnUpg.appendChild(document.createTextNode(" "));
        btnUpg.appendChild(span);
      }

      // Mostrar/ocultar el botón si hay siguiente plan
      btnUpg.style.display = nextSize ? "" : "none";
    }

    setAlertVisible(step3, true);
  }

  function maybeHideOrderAlert(wz) {
    const step3 = wz.querySelector(STEP3_SEL);
    const alert =
      step3.querySelector(ALERT_SEL) || document.querySelector(ALERT_SEL);
    if (!alert) return;
    // si no estamos pasados, cerrar
    const s = S(wz);
    const p = s.persons[curI(wz)] || {};
    const selected = countMeals(p);
    const planTotal = Number.isFinite(p?.plan?.size) ? p.plan.size : 0;
    if (!planTotal || selected <= planTotal) setAlertVisible(step3, false);
  }

  // ===== persistencia =====
  function saveState(wz) {
    try {
      const key = wz.getAttribute("data-form-id") || "default";
      localStorage.setItem(
        `WZ_MEAL_APP_STATE::${key}`,
        JSON.stringify(wz.__STATE__ || {})
      );
    } catch (e) {}
  }
})();

// --- NUEVO: lee categorías "en vivo" desde cada card (y su sub-lista CMS)
function getCatsLive(card) {
  const set = new Set();

  const addMany = (raw) => {
    String(raw || "")
      .split(/[,;/|]+/)
      .map((s) =>
        s
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
      .forEach((t) => set.add(t));
  };

  // a) si la card (o su contenedor) tuviera el atributo directo
  if (card.hasAttribute("data-category-name")) {
    addMany(card.getAttribute("data-category-name"));
  }

  // b) cualquier descendiente con data-category-name (incluye .w-dyn-item de la sub-lista)
  card.querySelectorAll("[data-category-name]").forEach((el) => {
    // tomar el atributo si existe, si no, texto visible del item
    addMany(el.getAttribute("data-category-name") || el.textContent);
  });

  return Array.from(set); // tokens normalizados (lowercase, sin acentos)
}

(() => {
  const STEP3_SEL = '[data-form="step-3"]';
  const SELECT_SEL = '[data-form="select-meals"]';
  const LIST_MEALS_SEL = '[data-form="list-meals"]';
  const MEAL_ITEM_SEL = "[data-meal-id][data-meal-name]";
  const CAT_SOURCE_SEL = '[data-form="select-data-meals"]';
  const CAT_ATTR = "data-category-name";
  const EMPTY_SEL = '[data-form="empty-meals"]';

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  function getCards(root) {
    const list = root.querySelector(LIST_MEALS_SEL);
    if (!list) return [];
    const dyn = Array.from(list.querySelectorAll(".w-dyn-item"));
    return dyn.length
      ? dyn
      : Array.from(list.querySelectorAll(MEAL_ITEM_SEL)).map(
          (n) => n.closest(".w-dyn-item") || n
        );
  }

  // Lee categorías "en vivo" desde la card y cualquier descendiente con data-category-name
  function getCatsLive(card) {
    const set = new Set();
    const addMany = (raw) => {
      String(raw || "")
        .split(/[,;/|]+/)
        .map((x) => norm(x))
        .filter(Boolean)
        .forEach((t) => set.add(t));
    };

    if (card.hasAttribute(CAT_ATTR)) addMany(card.getAttribute(CAT_ATTR));
    card.querySelectorAll(`[${CAT_ATTR}]`).forEach((el) => {
      // usar atributo si está, si no el texto
      addMany(el.getAttribute(CAT_ATTR) || el.textContent);
    });

    return Array.from(set); // tokens normalizados
  }

  // Indexa (opcional) para construir el select de forma rápida
  function indexCards(root) {
    getCards(root).forEach((card) => {
      card.hidden = false;
      card.style.display = "";
      card.classList.remove("is-hidden-by-filter");

      const tokens = getCatsLive(card);
      card.dataset.cats = tokens.join("|"); // ej: "vegetarian|gluten free"
    });
  }

  // Junta categorías desde fuente CMS y desde las cards
  function collectCats(root) {
    const out = new Set();

    // a) Fuente CMS
    const src = root.querySelector(CAT_SOURCE_SEL);
    if (src) {
      src.querySelectorAll(`[${CAT_ATTR}]`).forEach((n) => {
        String(n.getAttribute(CAT_ATTR) || n.textContent || "")
          .split(/[,;/|]+/)
          .map((x) => norm(x))
          .filter(Boolean)
          .forEach((t) => out.add(t));
      });
      if (!out.size) {
        src.querySelectorAll(".w-dyn-item").forEach((it) => {
          const t = norm(it.textContent || "");
          if (t) out.add(t);
        });
      }
    }

    // b) Desde las cards (en vivo, por si no hay fuente CMS)
    getCards(root).forEach((card) =>
      getCatsLive(card).forEach((t) => out.add(t))
    );

    return Array.from(out).sort();
  }

  function buildSelect(root) {
    const select = root.querySelector(SELECT_SEL);
    if (!select) return null;

    const cats = collectCats(root);
    const pretty = (s) => s.replace(/\b\w/g, (m) => m.toUpperCase());

    select.innerHTML =
      '<option value="">-- Select category --</option>' +
      cats.map((t) => `<option value="${t}">${pretty(t)}</option>`).join("");

    return select;
  }

  // FILTRO (usa categorías en vivo, no cache)
  function applyFilter(root, value) {
    const selected = norm(value);
    let visible = 0;

    getCards(root).forEach((card) => {
      const cats = getCatsLive(card); // ← clave
      const ok = !selected || cats.includes(selected);

      card.hidden = !ok;
      card.style.display = ok ? "" : "none"; // por si hay !important
      card.classList.toggle("is-hidden-by-filter", !ok);
      if (ok) visible++;
    });

    const empty = root.querySelector(EMPTY_SEL);
    if (empty) empty.style.display = visible ? "none" : "";
  }

  function init() {
    const root = document.querySelector(STEP3_SEL) || document;
    const select = root.querySelector(SELECT_SEL);
    if (!select) return;

    indexCards(root); // opcional, deja data-cats listo
    buildSelect(root); // llena el select (CMS + cards)
    applyFilter(root, ""); // arranca sin filtro

    if (!select.__bound) {
      select.__bound = true;
      select.addEventListener("change", () => applyFilter(root, select.value));
    }
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init, { once: true })
    : init();
})();

(() => {
  const WZ_SEL = '[data-form="multistep"]';
  const STEP3_SEL = '[data-form="step-3"]';
  const EDIT_BTN = '[data-form="edit-selection"]';

  function saveWzState(wz) {
    try {
      const key = wz.getAttribute("data-form-id") || "default";
      localStorage.setItem(
        `WZ_MEAL_APP_STATE::${key}`,
        JSON.stringify(wz.__STATE__ || {})
      );
    } catch (e) {}
  }

  function goEdit(btn) {
    const wz = btn.closest(WZ_SEL);
    if (!wz || !wz.FormWizard) return;

    // índice de la persona (del bloque del cart o contenedor con data-person-index)
    let i = 0;
    const holder =
      btn.closest("[data-person-index]") ||
      btn.closest('[data-form="price-item"]');
    if (holder) {
      const raw = holder.getAttribute("data-person-index");
      if (raw != null && !isNaN(parseInt(raw, 10))) i = parseInt(raw, 10);
    }

    // setear estado
    const S = (wz.__STATE__ ||= { persons: [] });
    const max = Math.max(0, (S.persons?.length || 1) - 1);
    S.curPerson = Math.max(0, Math.min(max, i));
    saveWzState(wz);

    // ubicar step-3
    const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
    const step3 = wz.querySelector(STEP3_SEL);
    const idxS3 = steps.indexOf(step3);
    const curIdx =
      typeof wz.FormWizard.current === "function"
        ? wz.FormWizard.current()
        : -1;
    if (idxS3 < 0) return;

    const flash = () => {
      if (!step3) return;
      step3.scrollIntoView({ behavior: "smooth", block: "start" });
      const current = step3.querySelector(
        '[data-form="persona-meals"]:not(.is-template):not([hidden])'
      );
      if (current) {
        current.classList.add("flash-edit");
        setTimeout(() => current.classList.remove("flash-edit"), 900);
      }
    };

    if (curIdx === idxS3) {
      // ya en step-3 → rehidratar forzando evento sintético
      wz.dispatchEvent(
        new CustomEvent("form:stepchange", {
          detail: {
            stepIndex: idxS3,
            stepsTotal: steps.length,
          },
        })
      );
      requestAnimationFrame(flash);
    } else {
      // navegar a step-3
      wz.FormWizard.goTo(idxS3);
      setTimeout(flash, 120);
    }
  }

  // delegación global
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest?.(EDIT_BTN);
      if (!btn) return;
      e.preventDefault();
      goEdit(btn);
    },
    true
  );
})();

// Filter Step 3
(function () {
  // ====== Config ======
  const FILTER_ROOT = document.getElementById("filter_selection"); // chips
  const LIST_ROOT = document.querySelector('[data-form="list-meals"]'); // cards
  const CHIP_SEL = ".fs-radio_field[data-cat]"; // label chip
  const CARD_ITEM = ".w-dyn-item"; // item CMS
  const CARD_NODE = ".meals_item"; // article de la card
  const CAT_ATTR = "data-category-name"; // en sub-collection
  const EMPTY_SEL = '[data-form="empty-meals"]'; // (opcional)
  let MODE = (FILTER_ROOT?.getAttribute("data-mode") || "or").toLowerCase(); // "or" | "and"

  if (!FILTER_ROOT || !LIST_ROOT) return;

  // ====== Utils ======
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  const splitMany = (raw) =>
    String(raw || "")
      .split(/[,;/|]+/)
      .map(norm)
      .filter(Boolean);

  // ====== Indexar chips ======
  const chips = Array.from(FILTER_ROOT.querySelectorAll(CHIP_SEL)).map((el) => {
    const val = norm(el.getAttribute("data-cat") || el.textContent);
    // Seguridad: evitar el typo "diary free" → "dairy free" (si te pasó en CMS)
    const fixed = val === "diary free" ? "dairy free" : val;
    el.dataset.token = fixed;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    return el;
  });

  // ====== Indexar cards (lee sub-collection) ======
  const items = Array.from(LIST_ROOT.querySelectorAll(CARD_ITEM)).map((it) => {
    const card = it.querySelector(CARD_NODE) || it;
    // tokens en vivo desde descendientes [data-category-name] (slug o texto)
    const set = new Set();
    it.querySelectorAll("[" + CAT_ATTR + "]").forEach((n) => {
      const att = n.getAttribute(CAT_ATTR);
      if (att) splitMany(att).forEach((t) => set.add(t));
      else splitMany(n.textContent).forEach((t) => set.add(t));
    });
    // fallback por si además quisieras poner un atributo directo en la card
    if (card.hasAttribute(CAT_ATTR))
      splitMany(card.getAttribute(CAT_ATTR)).forEach((t) => set.add(t));

    const tokens = Array.from(set);
    return { it, card, tokens };
  });

  // ====== Render vacío (opcional) ======
  function setEmptyState(visibleCount) {
    const empty = document.querySelector(EMPTY_SEL);
    if (!empty) return;
    empty.style.display = visibleCount ? "none" : "";
  }

  // ====== Lectura de selección ======
  function selectedTokens() {
    return chips
      .filter((c) => c.classList.contains("is-active"))
      .map((c) => c.dataset.token);
  }

  // ====== Aplicar filtro ======
  function apply() {
    const sel = selectedTokens();
    let visible = 0;

    items.forEach(({ it, tokens }) => {
      let ok = true;
      if (sel.length) {
        if (MODE === "and") {
          ok = sel.every((t) => tokens.includes(t));
        } else {
          ok = sel.some((t) => tokens.includes(t));
        }
      }
      it.hidden = !ok;
      it.style.display = ok ? "" : "none";
      it.classList.toggle("is-hidden-by-filter", !ok);
      if (ok) visible++;
    });

    setEmptyState(visible);
    return visible;
  }

  // ====== Toggle chip ======
  function toggleChip(el) {
    el.classList.toggle("is-active");
    // Pinta el botón visual si usás .fs-radio_button
    el.classList.toggle(
      "w--redirected-checked",
      el.classList.contains("is-active")
    );
    apply();
  }

  // Click / teclado en chips
  FILTER_ROOT.addEventListener("click", (e) => {
    const chip = e.target.closest(CHIP_SEL);
    if (!chip) return;
    e.preventDefault();
    toggleChip(chip);
  });
  FILTER_ROOT.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const chip = e.target.closest(CHIP_SEL);
    if (!chip) return;
    e.preventDefault();
    toggleChip(chip);
  });

  // Primera pasada (sin filtros activos)
  apply();

  // ====== API debug ======
  window.mealsFilter = {
    mode(next) {
      if (!next) return MODE;
      MODE = String(next).toLowerCase() === "and" ? "and" : "or";
      apply();
      return MODE;
    },
    clear() {
      chips.forEach((c) =>
        c.classList.remove("is-active", "w--redirected-checked")
      );
      return apply();
    },
    status() {
      return {
        mode: MODE,
        chips: chips.map((c) => ({
          text: c.textContent.trim(),
          val: c.dataset.token,
          active: c.classList.contains("is-active"),
        })),
        cards: items.length,
        selected: selectedTokens(),
      };
    },
    apply,
  };
})();

// Cart Template in Checkout
(function () {
  const CART_SEL = '[data-form="cart"]';
  const PRICE_ITEM_TPL = '[data-form="price-item"]';
  const ITEM_MEAL_TPL = '[data-form="item-meal"]'; // ← NUEVO
  const TOTAL_PRICE_SEL = '[data-form="total-price"]'; // ← tu selector
  const QTY_PEOPLE_SEL = '[data-form="quantity-total-persona"]';

  const cart = document.querySelector(CART_SEL);
  if (!cart) return;
  if (cart.getAttribute("data-cart-scope") !== "signup") return;

  // misma key que en el wizard (puede venir del propio cart o del <body>)
  const formId =
    cart.getAttribute("data-form-id") ||
    document.body.getAttribute("data-form-id") ||
    "default";
  const key = `WZ_MEAL_APP_STATE::${formId}`;

  // leer state
  let state = {};
  try {
    state = JSON.parse(localStorage.getItem(key) || "{}");
  } catch (e) {}
  const persons = Array.isArray(state.persons) ? state.persons : [];

  // helpers
  const fmtGBP = (n) => {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(n || 0);
    } catch {
      return "£" + Number(n || 0).toFixed(2);
    }
  };
  const pname = (p, i) =>
    p?.name && p.name.trim() ? p.name.trim() : `Person ${i + 1}`;

  // limpiar items previos
  cart
    .querySelectorAll(`${PRICE_ITEM_TPL}:not(.is-template)`)
    .forEach((n) => n.remove());
  cart
    .querySelectorAll(`${ITEM_MEAL_TPL}:not(.is-template)`)
    .forEach((n) => n.remove()); // ← NUEVO

  // ubicar templates
  const priceTpl =
    cart.querySelector(`${PRICE_ITEM_TPL}.is-template`) ||
    cart.querySelector(PRICE_ITEM_TPL);
  const itemTpl =
    cart.querySelector(`${ITEM_MEAL_TPL}.is-template`) ||
    cart.querySelector(ITEM_MEAL_TPL);
  let after = priceTpl || itemTpl || cart;

  // render líneas + meals + total
  let total = 0;
  persons.forEach((p, i) => {
    const size = Number.isFinite(p?.plan?.size) ? p.plan.size : null;
    const planName =
      p?.plan?.name && p.plan.name.trim()
        ? p.plan.name.trim()
        : size
        ? `${size} meal plan`
        : "Meal plan";
    const planPrice = Number(p?.plan?.price) || 0;
    total += planPrice;

    // línea de plan (si hay template)
    if (priceTpl) {
      const node = priceTpl.cloneNode(true);
      node.classList.remove("is-template");
      node.hidden = false;
      node.style.display = "";
      node.setAttribute("data-person-index", String(i));

      const badge = node.querySelector('[data-form="person-label"]');
      const planEl = node.querySelector('[data-form="meal-plan"]');
      const priceEl = node.querySelector('[data-form="price"]');
      if (badge) badge.textContent = pname(p, i);
      if (planEl) planEl.textContent = planName;
      if (priceEl) priceEl.textContent = fmtGBP(planPrice);

      // ↓↓↓ Edit link (antes de insertar el nodo en el DOM)
      const edit = node.querySelector('[data-form="edit-selection"]');
      if (edit) {
        const base =
          edit.getAttribute("href") ||
          edit.getAttribute("data-edit-dest") ||
          "/plan-selection"; // ← URL de la página del wizard

        const u = new URL(base, location.origin);
        u.searchParams.set("editselect", "1"); // <-- antes era "edit"
        u.searchParams.set("person", String(i));

        const formId =
          cart.getAttribute("data-form-id") ||
          document.body.getAttribute("data-form-id") ||
          "default";
        u.searchParams.set("form", formId);

        edit.setAttribute("href", u.pathname + u.search);
      }

      after.insertAdjacentElement("afterend", node);
      after = node;
    }

    // meals por persona (si hay template)
    if (itemTpl && p && p.meals && typeof p.meals === "object") {
      Object.keys(p.meals).forEach((id) => {
        const entry = p.meals[id] || {};
        const q = parseInt(entry.qty, 10) || 0;
        if (!q) return;

        const node = itemTpl.cloneNode(true);
        node.classList.remove("is-template");
        node.hidden = false;
        node.style.display = "";
        node.setAttribute("data-person-index", String(i));

        const badge = node.querySelector('[data-form="person-label"]');
        const nameEl = node.querySelector('[data-form="meal-plan"]');
        const qtyEl = node.querySelector('[data-form="quantity"]');
        if (badge) badge.textContent = pname(p, i);
        if (nameEl) nameEl.textContent = entry.name || id;
        if (qtyEl) qtyEl.textContent = String(q);

        after.insertAdjacentElement("afterend", node);
        after = node;
      });
    }
  });

  // total
  cart.querySelectorAll(TOTAL_PRICE_SEL).forEach((el) => {
    el.textContent = fmtGBP(total);
  });

  // cantidad de personas
  document.querySelectorAll(QTY_PEOPLE_SEL).forEach((el) => {
    el.textContent = String(persons.length);
  });

  // opcional: ocultar si no hay data
  if (!persons.length) cart.style.display = "none";
  else cart.style.display = "";
})();

//-- 1) Edit selection links (Cart -> Wizard) -->
(function () {
  const CART_SEL = '[data-form="cart"]';
  const EDIT_SEL = '[data-form="edit-selection"]';

  const cart = document.querySelector(CART_SEL);
  if (!cart) return;

  const formId =
    cart.getAttribute("data-form-id") ||
    document.body.getAttribute("data-form-id") ||
    "default";

  function baseDest(a) {
    // Podés overridear con data-edit-dest="/plan-selection"
    return (
      a.getAttribute("data-edit-dest") ||
      a.getAttribute("href") ||
      "/plan-selection"
    );
  }

  cart.querySelectorAll(EDIT_SEL).forEach((a) => {
    const holder = a.closest("[data-person-index]");
    const idx = holder
      ? parseInt(holder.getAttribute("data-person-index"), 10)
      : NaN;
    if (!Number.isFinite(idx)) return;

    const u = new URL(baseDest(a), location.origin);
    // ⚠️ No usar "edit", Webflow lo reserva
    u.searchParams.set("selection", "1");
    u.searchParams.set("person", String(idx));
    u.searchParams.set("form", formId);

    a.setAttribute("href", u.pathname + u.search);
  });
})();

// <!-- 2) Deep link: /plan-selection?selection=1&person=N&form=KEY -->

(function () {
  const WZ_SEL = '[data-form="multistep"]';

  function applyDeepLink(wz) {
    const params = new URLSearchParams(location.search);

    // Acepta el nuevo flag "selection=1" (y opcionalmente el viejo "editselect=1" por compat)
    const hasSelection =
      params.get("selection") === "1" || params.get("editselect") === "1";
    if (!hasSelection) return;

    // Si viene ?form=KEY, intenta cargar ese state
    const formKey = params.get("form");
    if (formKey) {
      try {
        const raw = localStorage.getItem(`WZ_MEAL_APP_STATE::${formKey}`);
        const obj = raw ? JSON.parse(raw) : null;
        if (obj && typeof obj === "object") {
          wz.__STATE__ = Object.assign({ persons: [] }, obj);
        }
      } catch {}
    }

    const steps = Array.from(wz.querySelectorAll('[data-form^="step-"]'));
    const step3 = wz.querySelector('[data-form="step-3"]');
    const idxS3 = steps.indexOf(step3);
    if (idxS3 < 0) return;

    const S = wz.__STATE__ || (wz.__STATE__ = { persons: [] });

    // person: acepta 0-based; si no existe, prueba 1-based (N-1)
    let i = parseInt(params.get("person") || "0", 10);
    const max = Math.max(0, (S.persons?.length || 1) - 1);
    if (!Number.isFinite(i)) i = 0;
    if (i > max && i - 1 >= 0 && i - 1 <= max) i = i - 1;
    i = Math.max(0, Math.min(max, i));

    S.curPerson = i;
    try {
      saveState(wz);
    } catch {}

    // Ir directo al Step-3
    if (wz.FormWizard && typeof wz.FormWizard.goTo === "function") {
      wz.FormWizard.goTo(idxS3);
    }

    // Rehidratar y dar feedback visual
    setTimeout(() => {
      try {
        wz.dispatchEvent(
          new CustomEvent("form:stepchange", {
            detail: { stepIndex: idxS3, stepsTotal: steps.length },
          })
        );
      } catch {}
      const current =
        step3 &&
        step3.querySelector(
          '[data-form="persona-meals"]:not(.is-template):not([hidden])'
        );
      if (current) {
        current.classList.add("flash-edit");
        setTimeout(() => current.classList.remove("flash-edit"), 900);
      }
    }, 50);
  }

  function run() {
    document.querySelectorAll(WZ_SEL).forEach(applyDeepLink);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", run, { once: true })
    : run();
})();

// Edit Selection
(function () {
  const CART_SEL = '[data-form="cart"]';
  const EDIT_SEL = '[data-form="edit-selection"]';
  const DEFAULT_PATH = "/plan-selection";

  const cart = document.querySelector(CART_SEL);
  if (!cart) return;

  const formId =
    cart.getAttribute("data-form-id") ||
    document.body.getAttribute("data-form-id") ||
    "default";

  function baseDest(a) {
    return (
      a.getAttribute("data-edit-dest") || a.getAttribute("href") || DEFAULT_PATH
    );
  }

  function buildUrl(a) {
    const holder = a.closest("[data-person-index]");
    const idx = holder
      ? parseInt(holder.getAttribute("data-person-index"), 10)
      : 0;

    const u = new URL(baseDest(a), location.origin);
    if (!u.pathname || u.pathname === "/") u.pathname = DEFAULT_PATH;

    // limpiar restos
    u.searchParams.delete("edit");
    u.searchParams.delete("editselect");

    // set correct params
    u.searchParams.set("selection", "1");
    u.searchParams.set("person", String(Number.isFinite(idx) ? idx : 0));
    u.searchParams.set("form", formId);

    return u;
  }

  function wireLink(a) {
    const u = buildUrl(a);
    a.setAttribute("href", u.pathname + "?" + u.searchParams.toString());
    a.setAttribute("target", "_self"); // por si algún script lo cambia

    // Fuerza navegación aunque otro script haga preventDefault
    a.removeEventListener("click", a.__editSelHandler__, true);
    a.__editSelHandler__ = function (e) {
      e.preventDefault();
      e.stopPropagation();
      // evita submit si es <button> dentro de form
      try {
        if (a.tagName === "BUTTON") a.setAttribute("type", "button");
      } catch {}

      // navega sí o sí
      location.assign(u.toString());
    };
    // uso en fase de captura para ganar prioridad
    a.addEventListener("click", a.__editSelHandler__, true);
  }

  function initAll(root = cart) {
    root.querySelectorAll(EDIT_SEL).forEach(wireLink);
  }

  // inicial
  initAll();

  // Reengancha en cambios dinámicos (CMS, clonaciones, etc.)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches && n.matches(EDIT_SEL)) wireLink(n);
          if (n.querySelector) initAll(n);
        });
      }
    }
  });
  mo.observe(cart, { childList: true, subtree: true });
})();

// Modal Working in Grid
(function () {
  const CARD_SEL = '[data-form="card"], [data-meal-id][data-meal-name]';
  const MODAL_SEL = '[data-form="modal-meal"]';
  const CLOSE_SEL = '[data-form="modalmeal-close"]';
  const CONTENT_SEL = "[data-modal-content]"; // opcional: para detectar clic fuera del contenido

  let current = null;

  const focusablesSel = [
    "a[href]",
    "area[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  // --- helpers ---
  const clean = (v) =>
    String(v || "")
      .replace(/^\s*[\{\(\s]+/, "")
      .replace(/[\}\)\s]+\s*$/, "")
      .trim();

  function ensurePortal(modal) {
    if (!modal || modal.__portalled) return modal;
    try {
      modal.__ph = document.createComment("modal-meal-placeholder");
      modal.parentNode && modal.parentNode.insertBefore(modal.__ph, modal);
    } catch {}
    document.body.appendChild(modal); // fuera de overflow/transform
    modal.__portalled = true;
    return modal;
  }

  // busca id/name en la card o en un hijo con esos atributos; si no, usa el título visible
  function getMetaFromCard(card) {
    const src = card.matches("[data-meal-id],[data-meal-name]")
      ? card
      : card.querySelector("[data-meal-id],[data-meal-name]") || card;

    const idAttr =
      src.getAttribute("data-meal-id") ||
      src.querySelector?.("[data-meal-id]")?.getAttribute("data-meal-id") ||
      "";
    let nameAttr =
      src.getAttribute("data-meal-name") ||
      src.querySelector?.("[data-meal-name]")?.getAttribute("data-meal-name") ||
      "";

    const id = clean(idAttr);
    let name = clean(nameAttr);

    if (!name || /[{]|[}]/.test(name)) {
      name =
        (
          card.querySelector(
            '[data-meal-title], .meal_name, [data-form="title"]'
          )?.textContent || ""
        ).trim() || id;
    }
    return { id, name };
  }

  function fillModal(modal, meta, card) {
    modal
      .querySelectorAll('[data-modal-field="meal-id"]')
      .forEach((el) => (el.textContent = meta.id));
    modal
      .querySelectorAll('[data-modal-field="meal-name"]')
      .forEach((el) => (el.textContent = meta.name));

    // clonado opcional de bloques de la card
    modal.querySelectorAll("[data-modal-clone]").forEach((el) => {
      const sel = el.getAttribute("data-modal-clone");
      const src = sel ? card?.querySelector(sel) : null;
      el.innerHTML = "";
      if (src) el.appendChild(src.cloneNode(true));
    });
  }

  function lockScroll(on) {
    const html = document.documentElement;
    if (on) {
      const prev = html.style.overflow;
      html.style.overflow = "hidden";
      return () => {
        html.style.overflow = prev;
      };
    }
    return () => {};
  }

  function trapKey(e) {
    if (!current) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;

    const f = Array.from(current.modal.querySelectorAll(focusablesSel)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (!f.length) return;

    const first = f[0],
      last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openModalForCard(card) {
    const modal =
      card.querySelector(MODAL_SEL) || document.querySelector(MODAL_SEL);
    if (!modal) return;

    ensurePortal(modal); // evita problemas de stacking/overflow

    const meta = getMetaFromCard(card);
    fillModal(modal, meta, card);

    // a11y + mostrar
    modal.setAttribute("role", modal.getAttribute("role") || "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-open");
    modal.style.display = "flex";
    modal.style.visibility = "visible";
    modal.style.opacity = "1";

    // opcional: si no tiene z-index, dale uno alto
    if (!modal.style.zIndex) modal.style.zIndex = "9999";

    const lastFocus = document.activeElement;
    const unlock = lockScroll(true);
    current = { modal, lastFocus, scrollLock: unlock, card };

    const firstFocusable = modal.querySelector(focusablesSel) || modal;
    setTimeout(() => firstFocusable?.focus?.({ preventScroll: true }), 0);

    modal.addEventListener("click", onModalClicks, true);
    document.addEventListener("keydown", trapKey, true);
  }

  function closeModal() {
    if (!current) return;
    const { modal, lastFocus, scrollLock } = current;

    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.style.visibility = "hidden";
    modal.style.opacity = "0";

    modal.removeEventListener("click", onModalClicks, true);
    document.removeEventListener("keydown", trapKey, true);
    scrollLock && scrollLock();
    try {
      lastFocus && lastFocus.focus({ preventScroll: true });
    } catch {}
    current = null;
  }

  function onModalClicks(e) {
    const isCloseBtn = e.target.closest(CLOSE_SEL);
    // cerrar si clic fuera del contenido (si marcás el contenedor con data-modal-content)
    const content = current?.modal.querySelector(CONTENT_SEL);
    const clickedOutside = content
      ? current.modal.contains(e.target) && !content.contains(e.target)
      : e.target === current?.modal;

    if (isCloseBtn || clickedOutside) {
      e.preventDefault();
      closeModal();
    }
  }

  // Delegación global: abrir desde cualquier card (evitando +/−, inputs, checkbox)
  document.addEventListener(
    "click",
    (e) => {
      const card = e.target.closest(CARD_SEL);
      if (!card) return;

      if (
        e.target.closest(
          '[data-meal-element="increment"], [data-meal-element="decrement"], [data-meal-element="input"], .meals_checkbox'
        )
      ) {
        return;
      }

      e.preventDefault();
      openModalForCard(card);
    },
    true
  );

  // API de debug
  window.mealModal = {
    openFor: (el) =>
      openModalForCard(el.closest ? el.closest(CARD_SEL) || el : el),
    close: closeModal,
  };
})();

// ======= Discount & Totals for Checkout Cart (SAVE[N] desde CMS) =======
(function () {
  const CART_SEL = '[data-form="cart"]';
  const SUBTOTAL_SEL = '[data-form="subtotal"]';
  const DISC_INPUT_SEL = '[data-form="discount"]';
  const DISC_PRICE_SEL = '[data-form="discount-price"]';
  const TOTAL_SEL = '[data-form="total-price"]';

  // 🤫 Collection List oculta: cada item con data-amount="10|20|30..."
  // Podés ponerla dentro del carrito. El selector lee dentro del cart.
  const CMS_ITEM_SEL = "[data-amount]";

  const cart = document.querySelector(CART_SEL);
  if (!cart) return;
  if (cart.getAttribute("data-cart-scope") !== "signup") return;

  const formId =
    cart.getAttribute("data-form-id") ||
    document.body.getAttribute("data-form-id") ||
    "default";
  const stateKey = `WZ_MEAL_APP_STATE::${formId}`;
  const discKey = `WZ_DISCOUNT_CODE::${formId}`;

  const fmtGBP = (n) => {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(n || 0);
    } catch {
      return "£" + Number(n || 0).toFixed(2);
    }
  };
  const norm = (s) =>
    String(s || "")
      .trim()
      .toUpperCase();

  // 1) Leer cupones desde la Collection: SAVE[N] donde N = data-amount
  function loadCouponsFromCMS() {
    const map = Object.create(null);
    cart.querySelectorAll(CMS_ITEM_SEL).forEach((el) => {
      const amt = Number(el.getAttribute("data-amount"));
      if (!Number.isFinite(amt) || amt <= 0) return;

      const code = `SAVE${amt}`.toUpperCase(); // ← nombre del cupón
      // (Opcionales) soporta límites si querés agregar data-min / data-max en el item
      const min = Number(el.getAttribute("data-min") || 0);
      const max = el.hasAttribute("data-max")
        ? Number(el.getAttribute("data-max"))
        : null;

      map[code] = {
        type: "percent",
        percent: amt, // % de descuento (10 → 10%)
        max: Number.isFinite(max) ? max : null, // tope £ (opcional)
        minSubtotal: Number.isFinite(min) ? min : 0,
      };
    });

    // Fallback por si el CMS está vacío (opcional: comentar si no lo querés)
    // if (!Object.keys(map).length) map['SAVE10'] = { type:'percent', percent:10, max:null, minSubtotal:0 };

    return map;
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(stateKey) || "{}");
    } catch {
      return {};
    }
  }

  // Subtotal principal: suma precios de los planes
  function computePlanSubtotal(state) {
    const persons = Array.isArray(state?.persons) ? state.persons : [];
    return persons.reduce((sum, p) => sum + (Number(p?.plan?.price) || 0), 0);
  }
  // Fallback por si necesitás sumar meals por unidad
  function computeMealsSubtotal(state) {
    const persons = Array.isArray(state?.persons) ? state.persons : [];
    let subtotal = 0;
    persons.forEach((p) => {
      const meals = p?.meals && typeof p.meals === "object" ? p.meals : {};
      Object.values(meals).forEach((entry) => {
        const q = parseInt(entry?.qty, 10) || 0;
        const price = Number(entry?.price) || 0;
        if (q > 0 && price > 0) subtotal += q * price;
      });
    });
    return subtotal;
  }

  function computeDiscount(subtotal, codeRaw, coupons) {
    const code = norm(codeRaw);
    const def = coupons[code];
    if (!def) return 0;
    if (subtotal <= (def.minSubtotal || 0)) return 0;

    if (def.type === "percent") {
      const pct = Math.max(0, Math.min(100, Number(def.percent) || 0));
      let val = subtotal * (pct / 100);
      if (Number.isFinite(def.max)) val = Math.min(val, def.max);
      return Math.max(0, Math.min(subtotal, val));
    } else {
      // (no lo usamos, pero queda por si algún día agregás "fixed")
      return Math.max(0, Math.min(subtotal, Number(def.amount) || 0));
    }
  }

  function paintMoney(selector, value) {
    cart.querySelectorAll(selector).forEach((el) => {
      el.textContent = fmtGBP(value);
    });
  }

  function paintDiscount(value) {
    const txt = value > 0 ? "−" + fmtGBP(value) : fmtGBP(0);
    cart.querySelectorAll(DISC_PRICE_SEL).forEach((el) => {
      el.textContent = txt;
    });
  }
  const clearSavedCode = () => {
    try {
      localStorage.removeItem(discKey);
    } catch {}
  };

  function applyAndRender() {
    // Recarga cupones desde CMS: si quitás un item, desaparece el código
    const COUPONS = loadCouponsFromCMS();

    const state = readState();
    let subtotal = computePlanSubtotal(state);
    if (subtotal <= 0) subtotal = computeMealsSubtotal(state);

    const input = cart.querySelector(DISC_INPUT_SEL);
    const code = norm(input ? input.value : "");

    if (!code) {
      // Input vacío → descuento en £0, total = subtotal, “borra” guardado
      paintMoney(SUBTOTAL_SEL, subtotal);
      paintDiscount(0);
      paintMoney(TOTAL_SEL, subtotal);
      if (input) {
        input.setCustomValidity("");
        clearSavedCode();
      }
      return;
    }

    const discount = computeDiscount(subtotal, code, COUPONS);

    paintMoney(SUBTOTAL_SEL, subtotal);
    paintDiscount(discount);
    paintMoney(TOTAL_SEL, Math.max(0, subtotal - discount));

    if (input) {
      if (!COUPONS[code]) {
        input.setCustomValidity("Invalid code");
      } else {
        input.setCustomValidity("");
        localStorage.setItem(discKey, code);
      }
      input.reportValidity?.();
    }
  }

  // Eventos del input
  const input = cart.querySelector(DISC_INPUT_SEL);
  if (input) {
    const saved = localStorage.getItem(discKey);
    if (saved) input.value = saved;

    ["input", "change", "keyup", "blur"].forEach((ev) => {
      input.addEventListener(ev, () => {
        if (!norm(input.value)) clearSavedCode(); // si se borra, limpiamos storage
        applyAndRender();
      });
    });
  }

  // Inicial
  applyAndRender();
})();

// ===== Delivery Saturday (UK cutoff Tue 14:30) + optional dropdown =====
(function () {
  const DAY_LABEL_SEL = '[data-form="schedule-day"]';
  const SELECT_SEL = '[data-form="schedule-select"]';

  // Config
  const TIMEZONE = "Europe/London";
  const CUTOFF_H = 14; // 14:30 UK
  const CUTOFF_M = 30;
  const FUTURE_WEEKS_IN_SELECT = 8; // cuántas semanas futuras listar

  // (opcional) persistir por form-id si ya lo usás
  const root =
    document.querySelector(SELECT_SEL)?.closest("[data-form-id]") ||
    document.body;
  const formId = root?.getAttribute("data-form-id") || "default";
  const STORAGE_KEY = `WZ_DELIVERY_SATURDAY::${formId}`;

  // --- Helpers de fecha en zona UK (sin librerías) ---
  const partsFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });
  const longFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function getUKParts(d = new Date()) {
    const parts = Object.fromEntries(
      partsFmt.formatToParts(d).map((p) => [p.type, p.value])
    );
    return {
      year: +parts.year,
      month: +parts.month,
      day: +parts.day,
      hour: +parts.hour,
      minute: +parts.minute,
      // 'Sun','Mon','Tue','Wed','Thu','Fri','Sat'
      weekday: parts.weekday,
    };
  }

  const WDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function addDaysUTC(ukDateUTC, days) {
    const d = new Date(ukDateUTC.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  // Crea un Date (UTC) que representa la medianoche UK de ese Y-M-D
  function makeUKMidnightUTC(y, m, d) {
    // 00:00 en UK = hora UTC variable por DST, pero usando Date.UTC + luego formateo con TZ funciona
    // Tomamos 00:00 UK → calculamos 00:00 como hora local UK componiendo y corrigiendo con la zona
    // Estrategia: construir el string "YYYY-MM-DDT00:00:00" y dejar que Intl lo muestre en UK.
    // Para cálculos sólo de fecha usamos UTC directo:
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }

  // ¿Ya pasó el cutoff (martes 14:30 UK)?
  function isAfterCutoffUK(now = new Date()) {
    const p = getUKParts(now);
    const dow = WDAY[p.weekday];

    if (dow < WDAY.Tue) return false; // antes del martes
    if (dow > WDAY.Tue) return true; // miércoles en adelante
    // es martes → comparar hora local UK
    if (p.hour > CUTOFF_H) return true;
    if (p.hour < CUTOFF_H) return false;
    return p.minute >= CUTOFF_M;
  }

  // Sábado por defecto según la regla
  function computeDefaultSaturday(now = new Date()) {
    const p = getUKParts(now);
    const dow = WDAY[p.weekday];

    // sábado de "esta semana" contado desde UK hoy
    const baseUTC = makeUKMidnightUTC(p.year, p.month, p.day);
    const daysUntilSat = (6 - dow + 7) % 7; // 0 si es sábado
    let saturdayUTC = addDaysUTC(baseUTC, daysUntilSat);

    // No entregamos el mismo sábado (hoy) ni si pasó el cutoff
    const afterCut = isAfterCutoffUK(now);
    if (dow === WDAY.Sat || afterCut) {
      saturdayUTC = addDaysUTC(saturdayUTC, 7);
    }
    return saturdayUTC;
  }

  // Formato: "Saturday, 9th November"
  function ordinal(n) {
    const mod10 = n % 10,
      mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (mod10 === 1) return `${n}st`;
    if (mod10 === 2) return `${n}nd`;
    if (mod10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function formatLongUK(dateUTC) {
    // Obtenemos weekday + month + day en UK
    const { day } = getUKParts(dateUTC);
    const s = longFmt.format(dateUTC); // e.g., "Saturday, 9 November"
    // Insertar sufijo ordinal
    return s.replace(/\b(\d{1,2})\b/, (_, d) => ordinal(+d));
  }

  function toISODateUK(dateUTC) {
    // ISO YYYY-MM-DD según la fecha UK mostrada (usando partes)
    const p = getUKParts(dateUTC);
    const pad = (n) => String(n).padStart(2, "0");
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  function fromISODateUK(iso) {
    // Convierte "YYYY-MM-DD" a UTC basado en medianoche UK de ese día
    const [y, m, d] = iso.split("-").map(Number);
    return makeUKMidnightUTC(y, m, d);
  }

  function paintSpan(dateUTC) {
    document.querySelectorAll(DAY_LABEL_SEL).forEach((el) => {
      el.textContent = formatLongUK(dateUTC);
      el.setAttribute("data-iso", toISODateUK(dateUTC));
    });
  }

  function buildSelect(defaultUTC) {
    const sel = document.querySelector(SELECT_SEL);
    if (!sel) return;

    // Limpiar y llenar
    sel.innerHTML = "";
    const options = [];
    for (let i = 0; i <= FUTURE_WEEKS_IN_SELECT; i++) {
      const d = addDaysUTC(defaultUTC, 7 * i);
      const val = toISODateUK(d);
      const label = formatLongUK(d);
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label + (i === 0 ? " (Default)" : "");
      options.push(opt);
    }
    options.forEach((o) => sel.appendChild(o));

    // Preselección: la guardada o default
    const savedISO = (function () {
      try {
        return localStorage.getItem(STORAGE_KEY) || "";
      } catch {
        return "";
      }
    })();
    const initialISO =
      savedISO && [...options].some((o) => o.value === savedISO)
        ? savedISO
        : toISODateUK(defaultUTC);
    sel.value = initialISO;
    // Pintar span con la opción actual
    paintSpan(fromISODateUK(initialISO));

    // Eventos
    sel.addEventListener("change", () => {
      const iso = sel.value;
      paintSpan(fromISODateUK(iso));
      try {
        localStorage.setItem(STORAGE_KEY, iso);
      } catch {}
    });
  }

  // Init
  const def = computeDefaultSaturday(new Date());
  paintSpan(def);
  buildSelect(def);
})();
