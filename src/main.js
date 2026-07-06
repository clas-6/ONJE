import './style.css'

function showFatalError(message) {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#070708;color:#fff;font-family:Outfit,system-ui,sans-serif">
      <div style="max-width:720px;width:100%;background:#151518;border:1px solid rgba(255,77,0,.25);border-radius:16px;padding:24px;box-shadow:0 0 24px rgba(255,77,0,.12)">
        <div style="color:#ff4d00;font-weight:700;font-size:14px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px">Startup Error</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:12px">The app failed to render.</div>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#0e0e11;padding:16px;border-radius:12px;color:#ffb4a0;overflow:auto">${String(message || 'Unknown error')}</pre>
      </div>
    </div>
  `
}

window.addEventListener('error', event => {
  showFatalError(event.error?.stack || event.message || 'Unknown error')
})

window.addEventListener('unhandledrejection', event => {
  showFatalError(event.reason?.stack || event.reason?.message || String(event.reason || 'Unhandled rejection'))
})

// --- STORAGE KEYS ---
const STORAGE_KEYS = {
  menu: 'onje_menu_items',
  orders: 'onje_orders',
  costs: 'onje_cost_entries',
  settings: 'onje_app_settings'
}

const MENU_CATEGORIES = ['Food', 'Drink', 'Spice', 'Cream', 'Powder']

// --- APPLICATION STATE ---
let menuItems = []
let allOrders = []
let activeOrders = []
let salesOrders = []
let costEntries = []
let currentUser = null
let inputPin = ''
let selectedRole = 'Admin'

// PIN Configs
const PINS = {
  Admin: '1234',
  Partner: '1234',
  Cook: '5555'
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch (err) {
    console.warn(`Failed to parse stored value for ${key}`, err)
    return fallback
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function getSettings() {
  return {
    chefWhatsapp: '',
    ...readJSON(STORAGE_KEYS.settings, {})
  }
}

function saveSettings(nextSettings) {
  writeJSON(STORAGE_KEYS.settings, nextSettings)
}

function getMenuItems() {
  const items = readJSON(STORAGE_KEYS.menu, [])
  return Array.isArray(items) ? items.map(normalizeMenuItem) : []
}

function saveMenuItems(items) {
  writeJSON(STORAGE_KEYS.menu, items)
}

function getOrders() {
  const orders = readJSON(STORAGE_KEYS.orders, [])
  return Array.isArray(orders) ? orders.map(normalizeOrder) : []
}

function saveOrders(orders) {
  writeJSON(STORAGE_KEYS.orders, orders)
}

function getCostEntries() {
  const costs = readJSON(STORAGE_KEYS.costs, [])
  return Array.isArray(costs) ? costs.map(normalizeCostEntry) : []
}

function saveCostEntries(entries) {
  writeJSON(STORAGE_KEYS.costs, entries)
}

function normalizeMenuItem(item) {
  return {
    id: Number(item?.id) || Date.now(),
    name: String(item?.name || '').trim(),
    price: Number(item?.price) || 0,
    category: MENU_CATEGORIES.includes(item?.category) ? item.category : 'Food',
    created_at: item?.created_at || new Date().toISOString()
  }
}

function normalizeOrder(order) {
  return {
    id: Number(order?.id) || Date.now(),
    customer_name: String(order?.customer_name || '').trim(),
    items: Array.isArray(order?.items) ? order.items : [],
    notes: order?.notes || null,
    status: order?.status || 'Waiting',
    total_price: Number(order?.total_price) || 0,
    profit: Number(order?.profit) || 0,
    created_at: order?.created_at || new Date().toISOString()
  }
}

function normalizeCostEntry(entry) {
  return {
    id: Number(entry?.id) || Date.now(),
    label: String(entry?.label || 'Expense').trim(),
    amount: Number(entry?.amount) || 0,
    note: String(entry?.note || '').trim(),
    created_at: entry?.created_at || new Date().toISOString()
  }
}

function nextOrderId() {
  const existingIds = allOrders.map(order => Number(order.id) || 0)
  const maxId = existingIds.length ? Math.max(...existingIds) : 0
  return maxId + 1
}

// Sound Synthesizer
function playNotificationSound(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (type === 'new_order') {
      const osc1 = audioCtx.createOscillator()
      const gain1 = audioCtx.createGain()
      osc1.connect(gain1)
      gain1.connect(audioCtx.destination)
      osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime)
      gain1.gain.setValueAtTime(0.08, audioCtx.currentTime)
      gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25)
      osc1.start()
      osc1.stop(audioCtx.currentTime + 0.25)

      setTimeout(() => {
        const osc2 = audioCtx.createOscillator()
        const gain2 = audioCtx.createGain()
        osc2.connect(gain2)
        gain2.connect(audioCtx.destination)
        osc2.frequency.setValueAtTime(698.46, audioCtx.currentTime)
        gain2.gain.setValueAtTime(0.08, audioCtx.currentTime)
        gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25)
        osc2.start()
        osc2.stop(audioCtx.currentTime + 0.25)
      }, 120)
    } else if (type === 'ready') {
      const freqs = [523.25, 659.25, 783.99, 1046.5]
      freqs.forEach((freq, idx) => {
        setTimeout(() => {
          const osc = audioCtx.createOscillator()
          const gain = audioCtx.createGain()
          osc.connect(gain)
          gain.connect(audioCtx.destination)
          osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
          gain.gain.setValueAtTime(0.06, audioCtx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35)
          osc.start()
          osc.stop(audioCtx.currentTime + 0.35)
        }, idx * 100)
      })
    }
  } catch (err) {
    console.warn('Web Audio API not supported or user gesture needed:', err)
  }
}

function updateConnectionBadge() {
  const status = document.getElementById('connection-status')
  if (!status) return

  status.className = 'db-status-badge online'
  const label = status.querySelector('.status-text')
  if (label) label.innerText = 'Local Storage'
}

function refreshState() {
  menuItems = getMenuItems().sort((a, b) => {
    const categorySort = MENU_CATEGORIES.indexOf(a.category) - MENU_CATEGORIES.indexOf(b.category)
    if (categorySort !== 0) return categorySort
    return a.name.localeCompare(b.name)
  })

  allOrders = getOrders().sort((a, b) => Number(a.id) - Number(b.id))
  activeOrders = allOrders.filter(order => order.status !== 'Delivered')
  salesOrders = allOrders
    .filter(order => order.status === 'Delivered')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  costEntries = getCostEntries().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

function loadData() {
  refreshState()
  updateConnectionBadge()
  renderOrderStats()
  renderMenuPage()
  renderOrderFormMenu()
  renderKitchenPage()
  renderRecentFeed()
  renderSalesPage()
}

function getAllTimeRevenue() {
  return salesOrders.reduce((sum, order) => sum + Number(order.total_price || 0), 0)
}

function getAllTimeCosts() {
  return costEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
}

function getAllTimeProfit() {
  return getAllTimeRevenue() - getAllTimeCosts()
}

// --- AUTHENTICATION & LOGIN ---
function setupLogin() {
  const roleButtons = document.querySelectorAll('.role-btn')
  const pinDots = document.querySelectorAll('.pin-display .dot')
  const keypadButtons = document.querySelectorAll('.key-btn[data-val]')
  const clearButton = document.getElementById('key-clear')
  const submitButton = document.getElementById('key-submit')
  const errorMsg = document.getElementById('login-error')

  const savedRole = sessionStorage.getItem('onje_user_role')
  const savedName = sessionStorage.getItem('onje_user_name')

  if (savedRole) {
    loginSuccess(savedRole, savedName)
  }

  roleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roleButtons.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedRole = btn.getAttribute('data-role')
      resetPinInput()
    })
  })

  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (inputPin.length >= 4) return
      inputPin += btn.getAttribute('data-val')
      errorMsg.classList.add('hidden')
      updatePinDots()

      if (inputPin.length === 4) {
        verifyPin()
      }
    })
  })

  clearButton.addEventListener('click', () => {
    if (inputPin.length > 0) {
      inputPin = inputPin.slice(0, -1)
      errorMsg.classList.add('hidden')
      updatePinDots()
    }
  })

  submitButton.addEventListener('click', verifyPin)

  function updatePinDots() {
    pinDots.forEach((dot, idx) => {
      if (idx < inputPin.length) {
        dot.classList.add('filled')
      } else {
        dot.classList.remove('filled')
      }
    })
  }

  function resetPinInput() {
    inputPin = ''
    updatePinDots()
    errorMsg.classList.add('hidden')
  }

  function verifyPin() {
    const correctPin = PINS[selectedRole]
    if (inputPin === correctPin) {
      const name = selectedRole === 'Admin' ? 'You' : selectedRole === 'Partner' ? 'Partner' : 'Cook'
      sessionStorage.setItem('onje_user_role', selectedRole)
      sessionStorage.setItem('onje_user_name', name)
      loginSuccess(selectedRole, name)
    } else {
      errorMsg.classList.remove('hidden')
      resetPinInput()

      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.frequency.setValueAtTime(120, audioCtx.currentTime)
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3)
        osc.start()
        osc.stop(audioCtx.currentTime + 0.3)
      } catch (e) {}
    }
  }
}

function loginSuccess(role, name) {
  currentUser = { role, name }

  document.getElementById('profile-name').innerText = name
  document.getElementById('profile-role').innerText = role === 'Cook' ? 'Kitchen Cook' : 'Administrator'

  const ordersLink = document.querySelector('.nav-link[data-page="orders"]')
  const menuLink = document.querySelector('.nav-link[data-page="menu"]')
  const salesLink = document.querySelector('.nav-link[data-page="sales"]')

  if (role === 'Cook') {
    ordersLink.classList.add('hidden')
    menuLink.classList.add('hidden')
    salesLink.classList.add('hidden')
    switchPage('kitchen')
  } else {
    ordersLink.classList.remove('hidden')
    menuLink.classList.remove('hidden')
    salesLink.classList.remove('hidden')
    switchPage('orders')
  }

  document.getElementById('login-overlay').classList.add('hidden')
  document.getElementById('app-container').classList.remove('hidden')

  loadData()
}

// --- CHEF WHATSAPP HELPERS ---
function sanitizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '')
}

function getChefWhatsappNumber(promptIfMissing = false) {
  const settings = getSettings()
  const saved = sanitizePhoneNumber(settings.chefWhatsapp)

  if (saved) return saved
  if (!promptIfMissing) return ''

  const input = window.prompt('Enter the chef WhatsApp number with country code, for example 2348012345678')
  if (!input) return ''

  const cleaned = sanitizePhoneNumber(input)
  if (!cleaned) {
    alert('Please enter a valid WhatsApp number.')
    return ''
  }

  saveSettings({
    ...settings,
    chefWhatsapp: cleaned
  })

  return cleaned
}

function buildChefMessage(order) {
  const orderedAt = new Date(order.created_at).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  })

  const itemsText = order.items
    .map(item => `- ${item.quantity} x ${item.name} (${item.category || 'Food'})`)
    .join('\n')

  return [
    `New Order #${order.id}`,
    `Customer: ${order.customer_name}`,
    `Time: ${orderedAt}`,
    '',
    'Items:',
    itemsText,
    '',
    `Notes: ${order.notes || 'None'}`,
    `Total: NGN ${Number(order.total_price).toLocaleString()}`,
    `Status: ${order.status}`
  ].join('\n')
}

function sendOrderToChef(order) {
  const phone = getChefWhatsappNumber(true)
  if (!phone) return false

  const message = buildChefMessage(order)
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  const win = window.open(url, '_blank', 'noopener,noreferrer')

  if (!win) {
    alert('Your browser blocked the WhatsApp window. Please allow popups for this site.')
    return false
  }

  return true
}

// --- PAGE ROUTING ---
function switchPage(pageId) {
  if (currentUser?.role === 'Cook' && pageId !== 'kitchen') {
    pageId = 'kitchen'
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-page') === pageId) {
      link.classList.add('active')
    } else {
      link.classList.remove('active')
    }
  })

  document.querySelectorAll('.app-page').forEach(page => {
    if (page.id === `page-${pageId}`) {
      page.classList.add('active')
    } else {
      page.classList.remove('active')
    }
  })

  const titleMap = {
    orders: 'Orders',
    kitchen: 'Kitchen',
    menu: 'Menu',
    sales: 'Sales'
  }
  document.getElementById('page-title').innerText = titleMap[pageId] || pageId

  if (pageId === 'sales') {
    renderSalesPage()
  }
}

// --- MENU MANAGEMENT ---
function renderMenuPage() {
  const tbody = document.getElementById('menu-items-table-body')

  if (menuItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center p-4 text-muted">No items in menu. Use the form on the left to add food, drinks, spices, creams, or powders!</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = menuItems
    .map(item => `
      <tr data-id="${item.id}">
        <td class="food-name font-lg">
          <div class="menu-item-name">${item.name}</div>
          <span class="menu-category-pill">${item.category}</span>
        </td>
        <td class="price-cell">
          <span class="view-price text-primary">&#8358;${Number(item.price).toLocaleString()}</span>
          <input type="number" class="edit-input hidden" value="${item.price}" min="0">
        </td>
        <td class="text-right">
          <div class="menu-actions">
            <button class="btn btn-secondary btn-icon btn-edit" title="Edit Price">
              <i class="fa-solid fa-pencil"></i>
            </button>
            <button class="btn btn-primary btn-icon btn-save hidden" title="Save Price">
              <i class="fa-solid fa-check"></i>
            </button>
            <button class="btn btn-danger btn-icon btn-delete" title="Delete Item">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `)
    .join('')

  tbody.querySelectorAll('tr').forEach(row => {
    const id = row.getAttribute('data-id')
    const viewPrice = row.querySelector('.view-price')
    const editInput = row.querySelector('.edit-input')
    const btnEdit = row.querySelector('.btn-edit')
    const btnSave = row.querySelector('.btn-save')
    const btnDelete = row.querySelector('.btn-delete')

    btnEdit.addEventListener('click', () => {
      viewPrice.classList.add('hidden')
      editInput.classList.remove('hidden')
      btnEdit.classList.add('hidden')
      btnSave.classList.remove('hidden')
      editInput.focus()
    })

    btnSave.addEventListener('click', () => {
      const newPrice = parseFloat(editInput.value)
      if (Number.isNaN(newPrice) || newPrice < 0) return

      menuItems = menuItems.map(item => {
        if (String(item.id) !== String(id)) return item
        return { ...item, price: newPrice }
      })

      saveMenuItems(menuItems)
      loadData()
    })

    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        btnSave.click()
      }
    })

    btnDelete.addEventListener('click', () => {
      if (!confirm('Are you sure you want to delete this menu item?')) return

      menuItems = menuItems.filter(item => String(item.id) !== String(id))
      saveMenuItems(menuItems)
      loadData()
    })
  })
}

function bindChefSettingsButton() {
  const button = document.getElementById('btn-chef-settings')
  if (!button) return

  button.addEventListener('click', () => {
    const current = getSettings().chefWhatsapp
    const next = window.prompt('Enter the chef WhatsApp number with country code', current)
    if (next === null) return

    const cleaned = sanitizePhoneNumber(next)
    if (!cleaned) {
      alert('Please enter a valid WhatsApp number.')
      return
    }

    saveSettings({
      ...getSettings(),
      chefWhatsapp: cleaned
    })

    alert('Chef WhatsApp number saved.')
  })
}

const addMenuItemForm = document.getElementById('menu-item-form')
if (addMenuItemForm) {
  addMenuItemForm.addEventListener('submit', e => {
    e.preventDefault()

    const nameInput = document.getElementById('item-name')
    const priceInput = document.getElementById('item-price')
    const categoryInput = document.getElementById('item-category')

    const name = nameInput.value.trim()
    const price = parseFloat(priceInput.value)
    const category = categoryInput.value

    if (!name || Number.isNaN(price)) return

    const nextItem = normalizeMenuItem({
      id: Date.now(),
      name,
      price,
      category,
      created_at: new Date().toISOString()
    })

    menuItems = [...menuItems, nextItem]
    saveMenuItems(menuItems)

    nameInput.value = ''
    priceInput.value = ''
    categoryInput.value = 'Food'
    loadData()
  })
}

const costForm = document.getElementById('cost-form')
if (costForm) {
  costForm.addEventListener('submit', e => {
    e.preventDefault()

    const labelInput = document.getElementById('cost-label')
    const amountInput = document.getElementById('cost-amount')
    const noteInput = document.getElementById('cost-note')

    const label = labelInput.value.trim()
    const amount = parseFloat(amountInput.value)
    const note = noteInput.value.trim()

    if (!label || Number.isNaN(amount)) return

    const entry = normalizeCostEntry({
      id: Date.now(),
      label,
      amount,
      note,
      created_at: new Date().toISOString()
    })

    costEntries = [...costEntries, entry]
    saveCostEntries(costEntries)

    labelInput.value = ''
    amountInput.value = ''
    noteInput.value = ''
    loadData()
  })
}

// --- ORDER CREATION ---
function renderOrderFormMenu() {
  const checklist = document.getElementById('food-checklist')
  const form = document.getElementById('order-form')
  const emptyCallout = document.getElementById('empty-menu-callout')

  const goToMenuButton = document.getElementById('btn-go-to-menu')
  if (goToMenuButton) {
    goToMenuButton.onclick = e => {
      e.preventDefault()
      switchPage('menu')
    }
  }

  if (menuItems.length === 0) {
    checklist.classList.add('hidden')
    form.classList.add('hidden')
    emptyCallout.classList.remove('hidden')
    return
  }

  checklist.classList.remove('hidden')
  form.classList.remove('hidden')
  emptyCallout.classList.add('hidden')

  checklist.innerHTML = menuItems
    .map(item => `
      <div class="food-check-row" data-id="${item.id}" data-price="${item.price}" data-category="${item.category}">
        <label class="food-check-label">
          <input type="checkbox" class="food-checkbox">
          <span class="custom-checkbox"></span>
          <span class="food-label-stack">
            <span class="food-name">${item.name}</span>
            <span class="menu-category-pill">${item.category}</span>
          </span>
        </label>
        <div class="qty-control">
          <button type="button" class="qty-btn qty-minus"><i class="fa-solid fa-minus"></i></button>
          <span class="qty-val">1</span>
          <button type="button" class="qty-btn qty-plus"><i class="fa-solid fa-plus"></i></button>
        </div>
        <span class="food-price font-lg text-primary">&#8358;${Number(item.price).toLocaleString()}</span>
      </div>
    `)
    .join('')

  checklist.querySelectorAll('.food-check-row').forEach(row => {
    const checkbox = row.querySelector('.food-checkbox')
    const qtyVal = row.querySelector('.qty-val')
    const btnMinus = row.querySelector('.qty-minus')
    const btnPlus = row.querySelector('.qty-plus')

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        row.classList.add('checked')
      } else {
        row.classList.remove('checked')
        qtyVal.innerText = '1'
      }
      updateOrderTotal()
    })

    btnMinus.addEventListener('click', e => {
      e.stopPropagation()
      let qty = parseInt(qtyVal.innerText, 10)
      if (qty > 1) {
        qty--
        qtyVal.innerText = qty
        updateOrderTotal()
      }
    })

    btnPlus.addEventListener('click', e => {
      e.stopPropagation()
      let qty = parseInt(qtyVal.innerText, 10)
      qty++
      qtyVal.innerText = qty
      updateOrderTotal()
    })
  })
}

function updateOrderTotal() {
  let total = 0
  let itemsCount = 0

  document.querySelectorAll('.food-check-row').forEach(row => {
    const checkbox = row.querySelector('.food-checkbox')
    if (checkbox.checked) {
      const price = parseFloat(row.getAttribute('data-price'))
      const qty = parseInt(row.querySelector('.qty-val').innerText, 10)
      total += price * qty
      itemsCount += qty
    }
  })

  document.getElementById('summary-items-count').innerText = itemsCount
  document.getElementById('summary-total').innerHTML = `&#8358;${total.toLocaleString()}`
  return total
}

function resetOrderForm() {
  document.getElementById('order-customer').value = ''
  document.getElementById('order-notes').value = ''
  document.querySelectorAll('.food-check-row').forEach(row => {
    row.classList.remove('checked')
    row.querySelector('.food-checkbox').checked = false
    row.querySelector('.qty-val').innerText = '1'
  })
  updateOrderTotal()
}

const orderForm = document.getElementById('order-form')
if (orderForm) {
  orderForm.addEventListener('submit', e => {
    e.preventDefault()

    const customerName = document.getElementById('order-customer').value.trim()
    const notes = document.getElementById('order-notes').value.trim()

    if (!customerName) return

    const items = []
    document.querySelectorAll('.food-check-row').forEach(row => {
      const checkbox = row.querySelector('.food-checkbox')
      if (checkbox.checked) {
        const name = row.querySelector('.food-name').innerText
        const price = parseFloat(row.getAttribute('data-price'))
        const quantity = parseInt(row.querySelector('.qty-val').innerText, 10)
        const category = row.getAttribute('data-category') || 'Food'
        items.push({ name, price, quantity, category })
      }
    })

    if (items.length === 0) {
      alert('Please select at least one item!')
      return
    }

    const totalPrice = updateOrderTotal()
    const profit = totalPrice * 0.45

    const order = normalizeOrder({
      id: nextOrderId(),
      customer_name: customerName,
      items,
      notes: notes || null,
      status: 'Waiting',
      total_price: totalPrice,
      profit,
      created_at: new Date().toISOString()
    })

    allOrders = [...allOrders, order]
    saveOrders(allOrders)

    resetOrderForm()
    loadData()
    playNotificationSound('new_order')
    sendOrderToChef(order)
  })
}

// --- RENDER LIVE FEED ON ORDERS TAB ---
function renderRecentFeed() {
  const container = document.getElementById('order-feed-list')
  if (activeOrders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt text-muted"></i>
        <p>No active orders placed yet today.</p>
      </div>
    `
    return
  }

  container.innerHTML = activeOrders
    .slice()
    .reverse()
    .map(order => {
      const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const itemsSummary = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
      const statusClass = order.status.toLowerCase()

      return `
        <div class="feed-item status-${statusClass}">
          <div class="feed-info">
            <span class="feed-title">ORDER #${order.id} • ${order.customer_name}</span>
            <span class="feed-desc text-muted">${itemsSummary}</span>
            <span class="feed-time"><i class="fa-regular fa-clock"></i> ${time}</span>
          </div>
          <span class="feed-status-badge ${statusClass}">${order.status}</span>
        </div>
      `
    })
    .join('')
}

function renderOrderStats() {
  const allTimeOrderCount = allOrders.length
  const activeOrderCount = activeOrders.length
  const allTimeSalesTotal = getAllTimeRevenue()

  const totalEl = document.getElementById('orders-stat-total')
  const activeEl = document.getElementById('orders-stat-active')
  const salesEl = document.getElementById('orders-stat-sales')

  if (totalEl) totalEl.innerText = allTimeOrderCount
  if (activeEl) activeEl.innerText = activeOrderCount
  if (salesEl) salesEl.innerHTML = `&#8358;${allTimeSalesTotal.toLocaleString()}`
}

// --- KITCHEN OPERATIONS ---
function renderKitchenPage() {
  const grid = document.getElementById('kitchen-orders-grid')

  let countWaiting = 0
  let countCooking = 0
  let countReady = 0

  activeOrders.forEach(order => {
    if (order.status === 'Waiting') countWaiting++
    if (order.status === 'Cooking') countCooking++
    if (order.status === 'Ready') countReady++
  })

  document.getElementById('k-stat-waiting').innerText = countWaiting
  document.getElementById('k-stat-cooking').innerText = countCooking
  document.getElementById('k-stat-ready').innerText = countReady

  const totalKitchenCount = countWaiting + countCooking + countReady
  const countBadge = document.getElementById('kitchen-count-badge')
  if (totalKitchenCount > 0) {
    countBadge.innerText = totalKitchenCount
    countBadge.classList.remove('hidden')
  } else {
    countBadge.classList.add('hidden')
  }

  if (activeOrders.length === 0) {
    grid.innerHTML = `
      <div class="empty-state full-width">
        <i class="fa-solid fa-fire-burner text-muted"></i>
        <h4>No Active Kitchen Orders</h4>
        <p>Orders will appear here as soon as they are placed.</p>
      </div>
    `
    return
  }

  grid.innerHTML = activeOrders
    .slice()
    .reverse()
    .map(order => {
      const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const itemsHtml = order.items
        .map((item, index) => `
          <div class="k-item-row">
            <i class="fa-regular fa-circle-check k-item-check" data-order="${order.id}" data-idx="${index}"></i>
            <span class="k-qty">${item.quantity}x</span>
            <span>${item.name}</span>
          </div>
        `)
        .join('')

      const notesHtml = order.notes
        ? `<div class="k-notes-box"><i class="fa-solid fa-comment-dots text-primary"></i> "${order.notes}"</div>`
        : ''

      const statusClass = order.status.toLowerCase()

      let actionBtnHtml = ''
      if (order.status === 'Waiting') {
        actionBtnHtml = `<button class="btn btn-primary btn-block btn-lg btn-status-change" data-id="${order.id}" data-next="Cooking">
          <i class="fa-solid fa-fire-burner"></i> Start Cooking
        </button>`
      } else if (order.status === 'Cooking') {
        actionBtnHtml = `<button class="btn btn-primary btn-block btn-lg btn-status-change" style="background: linear-gradient(135deg, var(--warning) 0%, #FF8800 100%)" data-id="${order.id}" data-next="Ready">
          <i class="fa-solid fa-bell"></i> Ready
        </button>`
      } else if (order.status === 'Ready') {
        if (currentUser?.role === 'Cook') {
          actionBtnHtml = `<div class="text-center text-muted p-2 font-lg"><i class="fa-solid fa-clock-rotate-left"></i> Waiting for pickup</div>`
        } else {
          actionBtnHtml = `<button class="btn btn-primary btn-block btn-lg btn-status-change" style="background: linear-gradient(135deg, var(--success) 0%, #00C853 100%)" data-id="${order.id}" data-next="Delivered">
            <i class="fa-solid fa-hand-holding-hand"></i> Collect & Deliver
          </button>`
        }
      }

      const whatsappBtnHtml = `<button class="btn btn-secondary btn-block btn-whatsapp-order" data-id="${order.id}">
        <i class="fa-brands fa-whatsapp"></i> Send to Chef
      </button>`

      return `
        <div class="kitchen-card status-${statusClass}" data-id="${order.id}">
          <div class="k-card-header">
            <span class="k-order-num">ORDER #${order.id}</span>
            <span class="k-order-time"><i class="fa-regular fa-clock"></i> ${time}</span>
          </div>

          <div class="k-customer-section">
            <span class="label">Customer</span>
            <span class="k-customer-name">${order.customer_name}</span>
          </div>

          <div class="k-items-section">
            <span class="label">Items</span>
            <div class="k-items-list">
              ${itemsHtml}
            </div>
          </div>

          ${notesHtml}

          <div class="k-status-box">
            <span class="label">Status</span>
            <span class="k-status-indicator status-${statusClass}">
              <i class="fa-solid ${order.status === 'Waiting' ? 'fa-hourglass' : order.status === 'Cooking' ? 'fa-fire-burner' : 'fa-circle-check'}"></i>
              ${order.status}
            </span>
          </div>

          <div class="k-action-section">
            ${actionBtnHtml}
            ${whatsappBtnHtml}
          </div>
        </div>
      `
    })
    .join('')

  grid.querySelectorAll('.btn-status-change').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      const nextStatus = btn.getAttribute('data-next')

      allOrders = allOrders.map(order => {
        if (String(order.id) !== String(id)) return order
        const updated = { ...order, status: nextStatus }
        if (nextStatus === 'Ready' && order.status !== 'Ready') {
          playNotificationSound('ready')
        }
        return updated
      })

      saveOrders(allOrders)
      loadData()
    })
  })

  grid.querySelectorAll('.btn-whatsapp-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      const order = allOrders.find(item => String(item.id) === String(id))
      if (!order) return
      sendOrderToChef(order)
    })
  })

  grid.querySelectorAll('.k-item-check').forEach(check => {
    check.addEventListener('click', () => {
      check.classList.toggle('fa-regular')
      check.classList.toggle('fa-solid')
      check.classList.toggle('checked')
    })
  })
}

// --- SALES REPORTING ---
function renderSalesPage() {
  const ordersCount = salesOrders.length
  const totalRevenue = getAllTimeRevenue()
  const totalCosts = getAllTimeCosts()
  const totalProfit = getAllTimeProfit()

  document.getElementById('sales-stat-orders').innerText = ordersCount
  document.getElementById('sales-stat-revenue').innerHTML = `&#8358;${totalRevenue.toLocaleString()}`
  document.getElementById('sales-stat-costs').innerHTML = `&#8358;${totalCosts.toLocaleString()}`
  document.getElementById('sales-stat-profit').innerHTML = `&#8358;${totalProfit.toLocaleString()}`

  const tbody = document.getElementById('sales-history-tbody')
  if (salesOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center p-4 text-muted">No sales logged yet. Mark orders "Delivered" on the Kitchen tab to see sales stats.</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = salesOrders
    .map(order => {
      const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const itemsSummary = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
      return `
        <tr>
          <td class="text-primary font-lg">#${order.id}</td>
          <td class="text-muted">${time}</td>
          <td class="font-lg">${order.customer_name}</td>
          <td>${itemsSummary}</td>
          <td>&#8358;${Number(order.total_price).toLocaleString()}</td>
          <td><span class="feed-status-badge delivered">${order.status}</span></td>
        </tr>
      `
    })
    .join('')

  renderCostLog()
}

function renderCostLog() {
  const tbody = document.getElementById('cost-history-tbody')
  if (!tbody) return

  if (costEntries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center p-4 text-muted">No costs logged yet.</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = costEntries
    .map(entry => {
      const time = new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      return `
        <tr data-id="${entry.id}">
          <td class="font-lg">${entry.label}</td>
          <td class="text-danger font-lg">&#8358;${Number(entry.amount).toLocaleString()}</td>
          <td>${entry.note || '<span class="text-muted">-</span>'}</td>
          <td class="text-muted">${time}</td>
          <td class="text-right">
            <button class="btn btn-danger btn-icon btn-delete-cost" data-id="${entry.id}" title="Delete Cost">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `
    })
    .join('')

  tbody.querySelectorAll('.btn-delete-cost').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id')
      if (!confirm('Delete this cost entry?')) return
      costEntries = costEntries.filter(entry => String(entry.id) !== String(id))
      saveCostEntries(costEntries)
      loadData()
    })
  })
}

// --- LIVE CLOCK ---
function startClock() {
  const clockEl = document.getElementById('live-clock')
  setInterval(() => {
    const now = new Date()
    clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }, 1000)
}

function bindSharedControls() {
  const sidebarToggle = document.getElementById('sidebar-toggle')
  const sidebarBackdrop = document.getElementById('sidebar-backdrop')

  function closeSidebar() {
    document.body.classList.remove('sidebar-open')
  }

  function toggleSidebar() {
    document.body.classList.toggle('sidebar-open')
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar)
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebar)
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault()
      const page = link.getAttribute('data-page')
      switchPage(page)
      closeSidebar()
    })
  })

  document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm('Log out of ONJE?')) {
      sessionStorage.removeItem('onje_user_role')
      sessionStorage.removeItem('onje_user_name')
      document.getElementById('app-container').classList.add('hidden')
      document.getElementById('login-overlay').classList.remove('hidden')
      closeSidebar()
      inputPin = ''
      document.querySelectorAll('.pin-display .dot').forEach(d => d.classList.remove('filled'))
      document.getElementById('login-error').classList.add('hidden')
    }
  })

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSidebar()
  })

  document.addEventListener('storage', event => {
    if ([STORAGE_KEYS.menu, STORAGE_KEYS.orders, STORAGE_KEYS.settings].includes(event.key)) {
      loadData()
    }
  })

  const chefButton = document.getElementById('btn-chef-settings')
  if (chefButton) {
    chefButton.addEventListener('click', () => {
      const current = getSettings().chefWhatsapp
      const next = window.prompt('Enter the chef WhatsApp number with country code', current)
      if (next === null) return

      const cleaned = sanitizePhoneNumber(next)
      if (!cleaned) {
        alert('Please enter a valid WhatsApp number.')
        return
      }

      saveSettings({
        ...getSettings(),
        chefWhatsapp: cleaned
      })

      alert('Chef WhatsApp number saved.')
    })
  }
}

// --- APPLICATION STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
  startClock()
  setupLogin()
  bindSharedControls()
  loadData()
})
