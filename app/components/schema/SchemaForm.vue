<template>
  <form @submit.prevent="handleSubmit" class="space-y-6">
    <!-- Schema Name -->
    <div>
      <label for="name" class="block text-sm font-medium mb-2">
        Schema Name *
      </label>
      <input
        id="name"
        v-model="name"
        type="text"
        required
        class="w-full px-4 py-2 border rounded-lg"
        placeholder="e.g., KYC Verification"
      />
    </div>

    <!-- Description -->
    <div>
      <label for="description" class="block text-sm font-medium mb-2">
        Description
      </label>
      <textarea
        id="description"
        v-model="description"
        rows="3"
        class="w-full px-4 py-2 border rounded-lg"
        placeholder="Describe what this schema is for..."
      />
    </div>

    <!-- Version -->
    <div>
      <label for="version" class="block text-sm font-medium mb-2">
        Version *
      </label>
      <input
        id="version"
        v-model="version"
        type="text"
        required
        pattern="^\d+\.\d+\.\d+$"
        class="w-full px-4 py-2 border rounded-lg"
        placeholder="1.0.0"
      />
    </div>

    <!-- Public/Private -->
    <div>
      <label class="flex items-center gap-2">
        <input v-model="isPublic" type="checkbox" class="w-4 h-4" />
        <span class="text-sm font-medium">
          Public schema (stored on IPFS)
        </span>
      </label>
      <p class="text-sm text-gray-600 mt-1">
        Public schemas are stored on IPFS and visible to everyone. Private
        schemas are stored on our service.
      </p>
    </div>

    <!-- Fields -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold">Fields</h3>
        <button
          type="button"
          @click="addField"
          class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Add Field
        </button>
      </div>

      <div class="space-y-4">
        <div
          v-for="(field, index) in fields"
          :key="index"
          class="p-4 border rounded-lg space-y-3"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium">Field {{ index + 1 }}</span>
            <button
              type="button"
              @click="removeField(index)"
              class="text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm mb-1">Field Name *</label>
              <input
                v-model="field.name"
                type="text"
                required
                class="w-full px-3 py-2 border rounded"
                placeholder="e.g., age"
              />
            </div>

            <div>
              <label class="block text-sm mb-1">Type *</label>
              <select
                v-model="field.type"
                class="w-full px-3 py-2 border rounded"
              >
                <option v-for="type in fieldTypes" :key="type" :value="type">
                  {{ type }}
                </option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm mb-1">Description</label>
            <input
              v-model="field.description"
              type="text"
              class="w-full px-3 py-2 border rounded"
              placeholder="Describe this field..."
            />
          </div>

          <div class="flex items-center gap-4">
            <label class="flex items-center gap-2">
              <input v-model="field.required" type="checkbox" class="w-4 h-4" />
              <span class="text-sm">Required</span>
            </label>

            <!-- Additional validation options based on type -->
            <template v-if="field.type === 'string'">
              <input
                v-model="field.pattern"
                type="text"
                class="flex-1 px-3 py-2 border rounded"
                placeholder="Regex pattern (optional)"
              />
            </template>

            <template v-if="field.type === 'number' || field.type === 'array'">
              <input
                v-model.number="field.min"
                type="number"
                class="w-24 px-3 py-2 border rounded"
                placeholder="Min"
              />
              <input
                v-model.number="field.max"
                type="number"
                class="w-24 px-3 py-2 border rounded"
                placeholder="Max"
              />
            </template>
          </div>
        </div>

        <div v-if="fields.length === 0" class="text-center py-8 text-gray-500">
          No fields added yet. Click "Add Field" to get started.
        </div>
      </div>
    </div>

    <!-- Submit -->
    <button
      type="submit"
      class="w-full px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold"
    >
      Create Schema
    </button>
  </form>
</template>
<script setup lang="ts">
import type { SchemaField } from '~/lib/types/schema';

const emit = defineEmits<{
  submit: [
    value: {
      name: string;
      description?: string;
      version: string;
      fields: SchemaField[];
      isPublic: boolean;
    },
  ];
}>();

const name = ref('');
const description = ref('');
const version = ref('1.0.0');
const isPublic = ref(false);
const fields = ref<SchemaField[]>([]);

const fieldTypes = [
  'string',
  'number',
  'boolean',
  'date',
  'address',
  'object',
  'array',
];

const addField = () => {
  fields.value.push({
    name: '',
    type: 'string',
    required: false,
    description: '',
  });
};

const removeField = (index: number) => {
  fields.value.splice(index, 1);
};

const handleSubmit = () => {
  // Validate
  if (!name.value || fields.value.length === 0) {
    alert('Name and at least one field are required');
    return;
  }

  // Check all fields have names
  const invalidFields = fields.value.some((f) => !f.name);
  if (invalidFields) {
    alert('All fields must have a name');
    return;
  }

  emit('submit', {
    name: name.value,
    description: description.value || undefined,
    version: version.value,
    fields: fields.value,
    isPublic: isPublic.value,
  });
};
</script>
