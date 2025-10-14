<template>
  <form @submit.prevent="handleSubmit" class="space-y-6">
    <!-- Schema Info -->
    <div class="p-4 bg-blue-50 rounded-lg">
      <h3 class="font-semibold mb-2">{{ schema.name }}</h3>
      <p class="text-sm text-gray-600">{{ schema.description }}</p>
      <span class="text-xs text-gray-500">Version: {{ schema.version }}</span>
    </div>

    <!-- Subject Address -->
    <div>
      <label for="subject" class="block text-sm font-medium mb-2">
        Subject Address (XRPL) *
      </label>
      <input
        id="subject"
        v-model="subject"
        type="text"
        required
        pattern="^r[1-9A-HJ-NP-Za-km-z]{25,34}$"
        class="w-full px-4 py-2 border rounded-lg font-mono"
        placeholder="rABCDEF123456..."
      />
    </div>

    <!-- Dynamic Fields -->
    <div class="space-y-4">
      <h3 class="text-lg font-semibold">Credential Data</h3>

      <div
        v-for="field in schema.fields.fields"
        :key="field.name"
        class="space-y-2"
      >
        <label :for="field.name" class="block text-sm font-medium">
          {{ field.name }}
          <span v-if="field.required" class="text-red-500">*</span>
        </label>

        <p v-if="field.description" class="text-xs text-gray-600">
          {{ field.description }}
        </p>

        <!-- String -->
        <input
          v-if="field.type === 'string'"
          :id="field.name"
          v-model="data[field.name]"
          type="text"
          :required="field.required"
          :pattern="field.pattern"
          class="w-full px-4 py-2 border rounded-lg"
        />

        <!-- Number -->
        <input
          v-else-if="field.type === 'number'"
          :id="field.name"
          v-model.number="data[field.name]"
          type="number"
          :required="field.required"
          :min="field.min"
          :max="field.max"
          class="w-full px-4 py-2 border rounded-lg"
        />

        <!-- Boolean -->
        <label
          v-else-if="field.type === 'boolean'"
          class="flex items-center gap-2"
        >
          <input
            :id="field.name"
            v-model="data[field.name]"
            type="checkbox"
            class="w-4 h-4"
          />
          <span class="text-sm">Yes</span>
        </label>

        <!-- Date -->
        <input
          v-else-if="field.type === 'date'"
          :id="field.name"
          v-model="data[field.name]"
          type="date"
          :required="field.required"
          class="w-full px-4 py-2 border rounded-lg"
        />

        <!-- Address -->
        <input
          v-else-if="field.type === 'address'"
          :id="field.name"
          v-model="data[field.name]"
          type="text"
          :required="field.required"
          pattern="^r[1-9A-HJ-NP-Za-km-z]{25,34}$"
          class="w-full px-4 py-2 border rounded-lg font-mono"
        />

        <!-- Object/Array (JSON textarea) -->
        <textarea
          v-else-if="field.type === 'object' || field.type === 'array'"
          :id="field.name"
          v-model="data[field.name]"
          rows="3"
          :required="field.required"
          class="w-full px-4 py-2 border rounded-lg font-mono text-sm"
          placeholder="Enter JSON"
        />
      </div>
    </div>

    <!-- Expiration -->
    <div>
      <label for="expiresAt" class="block text-sm font-medium mb-2">
        Expiration Date (Optional)
      </label>
      <input
        id="expiresAt"
        v-model="expiresAt"
        type="datetime-local"
        class="w-full px-4 py-2 border rounded-lg"
      />
    </div>

    <!-- Public/Private -->
    <div>
      <label class="flex items-center gap-2">
        <input v-model="isPublic" type="checkbox" class="w-4 h-4" />
        <span class="text-sm font-medium">
          Public credential (stored on IPFS)
        </span>
      </label>
      <p class="text-sm text-gray-600 mt-1">
        Public credentials are stored on IPFS and can be verified by anyone.
        Private credentials are stored on our service.
      </p>
    </div>

    <!-- Submit -->
    <button
      type="submit"
      class="w-full px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold"
    >
      Issue Credential
    </button>
  </form>
</template>

<script setup lang="ts">
import type { Schema } from '~/lib/types/schema';

const props = defineProps<{
  schema: Schema;
}>();

const emit = defineEmits<{
  submit: [
    value: {
      subject: string;
      data: Record<string, any>;
      isPublic: boolean;
      expiresAt?: string;
    },
  ];
}>();

const subject = ref('');
const isPublic = ref(false);
const expiresAt = ref('');
const data = ref<Record<string, any>>({});

// Initialize data object with schema fields
onMounted(() => {
  props.schema.fields.fields.forEach((field) => {
    if (field.type === 'boolean') {
      data.value[field.name] = false;
    } else if (field.type === 'number') {
      data.value[field.name] = 0;
    } else if (field.type === 'array') {
      data.value[field.name] = [];
    } else if (field.type === 'object') {
      data.value[field.name] = {};
    } else {
      data.value[field.name] = '';
    }
  });
});

const handleSubmit = () => {
  // Validate required fields
  const missingFields = props.schema.fields.fields
    .filter((f) => f.required && !data.value[f.name])
    .map((f) => f.name);

  if (missingFields.length > 0) {
    alert(`Missing required fields: ${missingFields.join(', ')}`);
    return;
  }

  emit('submit', {
    subject: subject.value,
    data: data.value,
    isPublic: isPublic.value,
    expiresAt: expiresAt.value || undefined,
  });
};
</script>
