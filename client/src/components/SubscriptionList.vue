<script setup lang="ts">
import { ref } from 'vue'
import { useSubscriptionsStore } from '../stores/subscriptions.js'
import ConfirmDialog from './ConfirmDialog.vue'

const store = useSubscriptionsStore()

const adding = ref(false)
const newName = ref('')
const newUrl = ref('')

function onColorInput(id: string, event: Event): void {
  store.setColor(id, (event.target as HTMLInputElement).value)
}

function submitAdd(): void {
  if (!newName.value.trim() || !newUrl.value.trim()) return
  store.add(newName.value.trim(), newUrl.value.trim())
  newName.value = ''
  newUrl.value = ''
  adding.value = false
}

const confirmingRemove = ref<{ id: string; name: string } | null>(null)

function onRemoveClick(id: string, name: string): void {
  confirmingRemove.value = { id, name }
}

function confirmRemove(): void {
  if (confirmingRemove.value) store.remove(confirmingRemove.value.id)
  confirmingRemove.value = null
}
</script>

<template>
  <div class="subscription-list">
    <div class="subscription-list__header">
      <h2 class="subscription-list__heading">Subscriptions</h2>
      <button type="button" class="subscription-list__add-btn" title="Add subscription" @click="adding = !adding">
        +
      </button>
    </div>

    <form v-if="adding" class="subscription-list__form" @submit.prevent="submitAdd">
      <input v-model="newName" type="text" placeholder="Name" required />
      <input v-model="newUrl" type="url" placeholder="https:// or webcal:// URL" required />
      <div class="subscription-list__form-actions">
        <button type="button" class="btn btn-ghost" @click="adding = false">Cancel</button>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
    </form>

    <ul>
      <li v-for="sub in store.subscriptions" :key="sub.id" class="subscription-list__item">
        <label class="subscription-list__toggle">
          <input type="checkbox" :checked="store.enabled[sub.id]" @change="store.toggle(sub.id)" />
          <span class="subscription-list__name">{{ sub.name }}</span>
        </label>
        <span v-if="store.errors[sub.id]" class="subscription-list__error" :title="store.errors[sub.id]">!</span>
        <input
          type="color"
          class="subscription-list__swatch"
          :value="sub.color"
          :title="`Color for ${sub.name}`"
          @input="onColorInput(sub.id, $event)"
        />
        <button
          type="button"
          class="subscription-list__remove"
          title="Remove"
          @click="onRemoveClick(sub.id, sub.name)"
        >
          ×
        </button>
      </li>
    </ul>

    <ConfirmDialog
      v-if="confirmingRemove"
      title="Remove subscription"
      :message="`Remove '${confirmingRemove.name}'? This only removes it from your subscription list; it doesn't affect the original calendar.`"
      confirm-label="Remove"
      @confirm="confirmRemove"
      @cancel="confirmingRemove = null"
    />
  </div>
</template>

<style scoped>
.subscription-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.subscription-list__heading {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-faint);
  margin: 0;
}
.subscription-list__add-btn {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.subscription-list__add-btn:hover {
  background: var(--color-surface-hover);
}
.subscription-list__form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  margin-bottom: 0.4rem;
  background: var(--color-surface-hover);
  border-radius: var(--radius-sm);
}
.subscription-list__form input {
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
}
.subscription-list__form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
.subscription-list__form-actions .btn {
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.subscription-list__item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
}
.subscription-list__item:hover {
  background: var(--color-surface-hover);
}
.subscription-list__toggle {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
  padding: 0.2rem 0;
  cursor: pointer;
}
.subscription-list__toggle input[type='checkbox'] {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
}
.subscription-list__name {
  font-size: 0.88rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subscription-list__error {
  flex-shrink: 0;
  color: var(--color-danger);
  font-weight: 700;
  font-size: 0.78rem;
  cursor: help;
}
.subscription-list__swatch {
  -webkit-appearance: none;
  appearance: none;
  width: 1.1rem;
  height: 1.1rem;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: 50%;
  background: none;
  cursor: pointer;
  overflow: hidden;
}
.subscription-list__swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}
.subscription-list__swatch::-webkit-color-swatch {
  border: none;
  border-radius: 50%;
}
.subscription-list__swatch::-moz-color-swatch {
  border: none;
  border-radius: 50%;
}
.subscription-list__remove {
  flex-shrink: 0;
  padding: 0 0.2rem;
  border: none;
  background: none;
  color: var(--color-text-faint);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
}
.subscription-list__remove:hover {
  color: var(--color-danger);
}
</style>
