import './style.css'
import { createClient } from '@supabase/supabase-js'

// --- APPLICATION STATE ---
let supabase = null
let menuItems = []
let activeOrders = []
let salesOrders = []
let currentUser = null

// PIN Configs
const PINS = {
  'Admin': '1234',
  'Partner': '1234',
  'Cook': '5555'
}

// Sound Synthesizer (No assets to load, fully synthesized on the fly)
function playNotificationSound(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (type === 'new_order') {
      // High double chime
      const osc1 = audioCtx.createOscillator()
      const gain1 = audioCtx.createGain()
      osc1.connect(gain1)
      gain1.connect(audioCtx.destination)
      osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime) // D5
      gain1.gain.setValueAtTime(0.08, audioCtx.currentTime)
      gain1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25)
      osc1.start()
      osc1.stop(audioCtx.currentTime + 0.25)
      
      setTimeout(() => {
        const osc2 = audioCtx.createOscillator()
        const gain2 = audioCtx.createGain()
        osc2.connect(gain2)
        gain2.connect(audioCtx.destination)
        osc2.frequency.setValueAtTime(698.46, audioCtx.currentTime) // F5
        gain2.gain.setValueAtTime(0.08, audioCtx.currentTime)
        gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25)
        osc2.start()
        osc2.stop(audioCtx.currentTime + 0.25)
      }, 120)
    } else if (type === 'ready') {
      // Upward success chord (C5 - E5 - G5 - C6)
      const freqs = [523.25, 659.25, 783.99, 1046.50]
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

// --- INITIALIZE DATABASE ---
function initDatabase() {
  const envUrl = import.meta.env.VITE_SUPABASE_URL
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  const localUrl = localStorage.getItem('onje_supabase_url')
  const localKey = localStorage.getItem('onje_supabase_key')

  const url = envUrl || localUrl
  const key = envKey || localKey

  if (!url || !key) {
    // Show setup screen
    document.getElementById('setup-overlay').classList.remove('hidden')
    return false
  }

  try {
    supabase = createClient(url, key)
    setupRealtimeSubscriptions()
    return true
  } catch (err) {
    console.error('Supabase initialization failed:', err)
    alert('Failed to connect to Supabase. Resetting credentials.')
    localStorage.removeItem('onje_supabase_url')
    localStorage.removeItem('onje_supabase_key')
    window.location.reload()
    return false
  }
}

// Setup real-time listener for orders and menu
function setupRealtimeSubscriptions() {
  if (!supabase) return

  // Subscribe to Orders
  supabase
    .channel('orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
      console.log('Realtime Order Change:', payload)
      
      // Determine if sound should play
      const oldRecord = payload.old
      const newRecord = payload.new
      
      if (payload.eventType === 'INSERT') {
        // Play sound for new orders if Cook or Admin
        playNotificationSound('new_order')
      } else if (payload.eventType === 'UPDATE' && newRecord.status === 'Ready' && oldRecord.status !== 'Ready') {
        // Play sound when order is marked Ready (alerting Admins)
        playNotificationSound('ready')
      }

      loadData()
    })
    .subscribe()

  // Subscribe to Menu changes
  supabase
    .channel('menu-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, () => {
      loadData()
    })
    .subscribe()
}

// --- DATA FETCHING ---
let retryTimeout = null

async function loadData() {
  if (!supabase) return

  try {
    document.getElementById('connection-status').className = 'db-status-badge online'
    document.getElementById('connection-status').querySelector('.status-text').innerText = 'Connected'

    // 1. Fetch Menu
    const { data: menuData, error: menuErr } = await supabase
      .from('menu')
      .select('*')
      .order('name', { ascending: true })

    if (menuErr) throw menuErr
    menuItems = menuData || []
    renderMenuPage()
    renderOrderFormMenu()

    // 2. Fetch Active Orders (Waiting, Cooking, Ready)
    const { data: activeData, error: activeErr } = await supabase
      .from('orders')
      .select('*')
      .neq('status', 'Delivered')
      .order('id', { ascending: true })

    if (activeErr) throw activeErr
    activeOrders = activeData || []
    renderKitchenPage()
    renderRecentFeed()

    // 3. Fetch Today's Completed Sales Orders (Delivered today)
    const todayStart = new Date()
    todayStart.setHours(0,0,0,0)

    const { data: salesData, error: salesErr } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'Delivered')
      .gte('created_at', todayStart.toISOString())
      .order('created_at', { ascending: false })

    if (salesErr) throw salesErr
    salesOrders = salesData || []
    renderSalesPage()

    // Clear any pending retry
    if (retryTimeout) {
      clearTimeout(retryTimeout)
      retryTimeout = null
    }

  } catch (err) {
    console.error('Data loading error:', err)
    document.getElementById('connection-status').className = 'db-status-badge offline'
    document.getElementById('connection-status').querySelector('.status-text').innerText = 'Reconnecting...'
    
    // Schedule a retry if not already scheduled
    if (!retryTimeout) {
      retryTimeout = setTimeout(() => {
        retryTimeout = null
        loadData()
      }, 5000)
    }
  }
}

// --- AUTHENTICATION & LOGIN ---
let inputPin = ''
let selectedRole = 'Admin'

function setupLogin() {
  const roleButtons = document.querySelectorAll('.role-btn')
  const pinDots = document.querySelectorAll('.pin-display .dot')
  const keypadButtons = document.querySelectorAll('.key-btn[data-val]')
  const clearButton = document.getElementById('key-clear')
  const submitButton = document.getElementById('key-submit')
  const errorMsg = document.getElementById('login-error')

  // Check Session Storage for active login
  const savedRole = sessionStorage.getItem('onje_user_role')
  const savedName = sessionStorage.getItem('onje_user_name')

  if (savedRole) {
    loginSuccess(savedRole, savedName)
  }

  // Handle Role Selection
  roleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roleButtons.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedRole = btn.getAttribute('data-role')
      resetPinInput()
    })
  })

  // Keypad Actions
  keypadButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (inputPin.length >= 4) return
      inputPin += btn.getAttribute('data-val')
      errorMsg.classList.add('hidden')
      updatePinDots()
      
      // Auto-submit on 4 digits
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
      
      // Play brief error hum
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
  
  // Update Profile Panel
  document.getElementById('profile-name').innerText = name
  document.getElementById('profile-role').innerText = role === 'Cook' ? 'Kitchen Cook' : 'Administrator'
  
  // Configure Access Control
  const ordersLink = document.querySelector('.nav-link[data-page="orders"]')
  const menuLink = document.querySelector('.nav-link[data-page="menu"]')
  const salesLink = document.querySelector('.nav-link[data-page="sales"]')
  const kitchenLink = document.querySelector('.nav-link[data-page="kitchen"]')

  if (role === 'Cook') {
    // Hide administrative links from side bar
    ordersLink.classList.add('hidden')
    menuLink.classList.add('hidden')
    salesLink.classList.add('hidden')
    
    // Cook defaults to Kitchen
    switchPage('kitchen')
  } else {
    // Show all links
    ordersLink.classList.remove('hidden')
    menuLink.classList.remove('hidden')
    salesLink.classList.remove('hidden')
    
    switchPage('orders')
  }

  // Fade out login overlay
  document.getElementById('login-overlay').classList.add('hidden')
  document.getElementById('app-container').classList.remove('hidden')

  // Load backend data
  loadData()
}

// --- SETUP FORM (SUPABASE BACKUP) ---
document.getElementById('setup-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const url = document.getElementById('setup-url').value.trim()
  const key = document.getElementById('setup-key').value.trim()

  if (url && key) {
    localStorage.setItem('onje_supabase_url', url)
    localStorage.setItem('onje_supabase_key', key)
    document.getElementById('setup-overlay').classList.add('hidden')
    window.location.reload()
  }
})

// Database settings modal trigger
document.getElementById('btn-db-settings').addEventListener('click', () => {
  if (confirm('Do you want to reset your database connection details?')) {
    localStorage.removeItem('onje_supabase_url')
    localStorage.removeItem('onje_supabase_key')
    sessionStorage.clear()
    window.location.reload()
  }
})

// --- PAGE ROUTING ---
function switchPage(pageId) {
  // Guard role navigation
  if (currentUser?.role === 'Cook' && pageId !== 'kitchen') {
    pageId = 'kitchen'
  }

  // Update navbar styling
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-page') === pageId) {
      link.classList.add('active')
    } else {
      link.classList.remove('active')
    }
  })

  // Update visible sections
  document.querySelectorAll('.app-page').forEach(page => {
    if (page.id === `page-${pageId}`) {
      page.classList.add('active')
    } else {
      page.classList.remove('active')
    }
  })

  // Update page header text
  document.getElementById('page-title').innerText = pageId

  // Trigger page specific renders if needed
  if (pageId === 'sales') {
    renderSalesPage()
  }
}

// Event Listeners for Nav Link switches
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    const page = link.getAttribute('data-page')
    switchPage(page)
  })
})

// Logout Logic
document.getElementById('logout-btn').addEventListener('click', () => {
  if (confirm('Log out of ÒNJẸ?')) {
    sessionStorage.removeItem('onje_user_role')
    sessionStorage.removeItem('onje_user_name')
    document.getElementById('app-container').classList.add('hidden')
    document.getElementById('login-overlay').classList.remove('hidden')
    // Reset key entry
    inputPin = ''
    document.querySelectorAll('.pin-display .dot').forEach(d => d.classList.remove('filled'))
    document.getElementById('login-error').classList.add('hidden')
  }
})

// --- MENU MANAGEMENT ---
const addMenuItemForm = document.getElementById('menu-item-form')

addMenuItemForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!supabase) return

  const nameInput = document.getElementById('item-name')
  const priceInput = document.getElementById('item-price')
  
  const name = nameInput.value.trim()
  const price = parseFloat(priceInput.value)

  if (!name || isNaN(price)) return

  try {
    const { error } = await supabase
      .from('menu')
      .insert([{ name, price }])

    if (error) throw error

    nameInput.value = ''
    priceInput.value = ''
    loadData()
  } catch (err) {
    console.error('Error adding menu item:', err)
    alert('Failed to add item: ' + err.message)
  }
})

function renderMenuPage() {
  const tbody = document.getElementById('menu-items-table-body')
  
  if (menuItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-center p-4 text-muted">No items in menu. Use the form on the left to add food or drinks!</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = menuItems.map(item => `
    <tr data-id="${item.id}">
      <td class="food-name font-lg">${item.name}</td>
      <td class="price-cell">
        <span class="view-price text-primary">₦${parseFloat(item.price).toLocaleString()}</span>
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
  `).join('')

  // Bind edit action listeners
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

    btnSave.addEventListener('click', async () => {
      const newPrice = parseFloat(editInput.value)
      if (isNaN(newPrice) || newPrice < 0) return

      try {
        const { error } = await supabase
          .from('menu')
          .update({ price: newPrice })
          .eq('id', id)

        if (error) throw error
        loadData()
      } catch (err) {
        console.error('Error updating price:', err)
        alert('Update failed: ' + err.message)
      }
    })

    // Pressing Enter saves
    editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnSave.click()
      }
    })

    btnDelete.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete this menu item?')) return
      try {
        const { error } = await supabase
          .from('menu')
          .delete()
          .eq('id', id)

        if (error) throw error
        loadData()
      } catch (err) {
        console.error('Error deleting menu item:', err)
        alert('Delete failed: ' + err.message)
      }
    })
  })
}

// --- ORDER CREATION ---
function renderOrderFormMenu() {
  const checklist = document.getElementById('food-checklist')
  const form = document.getElementById('order-form')
  const emptyCallout = document.getElementById('empty-menu-callout')

  // Quick link helper
  document.getElementById('btn-go-to-menu').onclick = (e) => {
    e.preventDefault()
    switchPage('menu')
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

  checklist.innerHTML = menuItems.map(item => `
    <div class="food-check-row" data-id="${item.id}" data-price="${item.price}">
      <label class="food-check-label">
        <input type="checkbox" class="food-checkbox">
        <span class="custom-checkbox"></span>
        <span class="food-name">${item.name}</span>
      </label>
      <div class="qty-control">
        <button type="button" class="qty-btn qty-minus"><i class="fa-solid fa-minus"></i></button>
        <span class="qty-val">1</span>
        <button type="button" class="qty-btn qty-plus"><i class="fa-solid fa-plus"></i></button>
      </div>
      <span class="food-price font-lg text-primary">₦${parseFloat(item.price).toLocaleString()}</span>
    </div>
  `).join('')

  // Bind checkbox events & quantity selectors
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
        qtyVal.innerText = '1' // reset
      }
      updateOrderTotal()
    })

    btnMinus.addEventListener('click', (e) => {
      e.stopPropagation()
      let qty = parseInt(qtyVal.innerText)
      if (qty > 1) {
        qty--
        qtyVal.innerText = qty
        updateOrderTotal()
      }
    })

    btnPlus.addEventListener('click', (e) => {
      e.stopPropagation()
      let qty = parseInt(qtyVal.innerText)
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
      const qty = parseInt(row.querySelector('.qty-val').innerText)
      total += price * qty
      itemsCount += qty
    }
  })

  document.getElementById('summary-items-count').innerText = itemsCount
  document.getElementById('summary-total').innerText = `₦${total.toLocaleString()}`
  return total
}

// Handle order submissions
document.getElementById('order-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!supabase) return

  const customerName = document.getElementById('order-customer').value.trim()
  const notes = document.getElementById('order-notes').value.trim()

  if (!customerName) return

  const items = []
  document.querySelectorAll('.food-check-row').forEach(row => {
    const checkbox = row.querySelector('.food-checkbox')
    if (checkbox.checked) {
      const name = row.querySelector('.food-name').innerText
      const price = parseFloat(row.getAttribute('data-price'))
      const quantity = parseInt(row.querySelector('.qty-val').innerText)
      items.push({ name, price, quantity })
    }
  })

  if (items.length === 0) {
    alert('Please select at least one item!')
    return
  }

  const totalPrice = updateOrderTotal()
  // Profit calculation: 45% (Option A)
  const profit = totalPrice * 0.45

  try {
    const { error } = await supabase
      .from('orders')
      .insert([{
        customer_name: customerName,
        items,
        notes: notes || null,
        status: 'Waiting',
        total_price: totalPrice,
        profit: profit
      }])

    if (error) throw error

    // Success reset
    document.getElementById('order-customer').value = ''
    document.getElementById('order-notes').value = ''
    document.querySelectorAll('.food-check-row').forEach(row => {
      row.classList.remove('checked')
      row.querySelector('.food-checkbox').checked = false
      row.querySelector('.qty-val').innerText = '1'
    })
    updateOrderTotal()
    
    // Open a visual confirmation overlay or show notifications
    loadData()
  } catch (err) {
    console.error('Error creating order:', err)
    alert('Failed to place order: ' + err.message)
  }
})

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

  container.innerHTML = activeOrders.map(order => {
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
  }).join('')
}

// --- KITCHEN OPERATIONS ---
function renderKitchenPage() {
  const grid = document.getElementById('kitchen-orders-grid')
  
  // Update stats counters
  let countWaiting = 0
  let countCooking = 0
  let countReady = 0

  activeOrders.forEach(o => {
    if (o.status === 'Waiting') countWaiting++
    if (o.status === 'Cooking') countCooking++
    if (o.status === 'Ready') countReady++
  })

  document.getElementById('k-stat-waiting').innerText = countWaiting
  document.getElementById('k-stat-cooking').innerText = countCooking
  document.getElementById('k-stat-ready').innerText = countReady
  
  // Kitchen count badge in sidebar
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

  grid.innerHTML = activeOrders.map(order => {
    const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const itemsHtml = order.items.map((i, index) => `
      <div class="k-item-row">
        <i class="fa-regular fa-circle-check k-item-check" data-order="${order.id}" data-idx="${index}"></i>
        <span class="k-qty">${i.quantity}x</span>
        <span>${i.name}</span>
      </div>
    `).join('')

    const notesHtml = order.notes ? `<div class="k-notes-box"><i class="fa-solid fa-comment-dots text-primary"></i> "${order.notes}"</div>` : ''
    const statusClass = order.status.toLowerCase()
    
    // Render status specific actions
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
        // Only Admin or Partner can Deliver/Collect and Archive
        actionBtnHtml = `<button class="btn btn-primary btn-block btn-lg btn-status-change" style="background: linear-gradient(135deg, var(--success) 0%, #00C853 100%)" data-id="${order.id}" data-next="Delivered">
          <i class="fa-solid fa-hand-holding-hand"></i> Collect & Deliver
        </button>`
      }
    }

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
        </div>
      </div>
    `
  }).join('')

  // Bind change events
  grid.querySelectorAll('.btn-status-change').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id')
      const nextStatus = btn.getAttribute('data-next')
      
      try {
        const { error } = await supabase
          .from('orders')
          .update({ status: nextStatus })
          .eq('id', id)

        if (error) throw error
        loadData()
      } catch (err) {
        console.error('Error changing order status:', err)
        alert('Failed to change status: ' + err.message)
      }
    })
  })

  // Kitchen checklists for the cook (interactively cross items off check list)
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
  // Update stats counters
  let totalRevenue = 0
  let totalProfit = 0
  const ordersCount = salesOrders.length

  salesOrders.forEach(o => {
    totalRevenue += parseFloat(o.total_price)
    totalProfit += parseFloat(o.profit)
  })

  document.getElementById('sales-stat-orders').innerText = ordersCount
  document.getElementById('sales-stat-revenue').innerText = `₦${totalRevenue.toLocaleString()}`
  document.getElementById('sales-stat-profit').innerText = `₦${totalProfit.toLocaleString()}`

  // Render Table History
  const tbody = document.getElementById('sales-history-tbody')
  if (salesOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center p-4 text-muted">No sales logged today yet. Mark orders "Delivered" on the Kitchen tab to see sales stats.</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = salesOrders.map(order => {
    const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const itemsSummary = order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
    return `
      <tr>
        <td class="text-primary font-lg">#${order.id}</td>
        <td class="text-muted">${time}</td>
        <td class="font-lg">${order.customer_name}</td>
        <td>${itemsSummary}</td>
        <td>₦${parseFloat(order.total_price).toLocaleString()}</td>
        <td class="text-success font-lg">₦${parseFloat(order.profit).toLocaleString()}</td>
        <td><span class="feed-status-badge delivered">${order.status}</span></td>
      </tr>
    `
  }).join('')
}

// --- LIVE CLOCK ---
function startClock() {
  const clockEl = document.getElementById('live-clock')
  setInterval(() => {
    const now = new Date()
    clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }, 1000)
}

// --- APPLICATION STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
  startClock()
  setupLogin()

  const dbConnected = initDatabase()
  if (dbConnected) {
    loadData()
  }
})
