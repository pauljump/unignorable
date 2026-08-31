(() => {
  'use strict';

  const modelContext = document.modelContext;
  const bridge = window.UnignorableWebMCPBridge;
  if (typeof modelContext?.registerTool !== 'function' || !bridge) return;

  const registration = new AbortController();
  const emptyObjectSchema = { type: 'object', properties: {}, additionalProperties: false };
  const categories = [
    'encampment',
    'drug_activity',
    'illegal_dumping',
    'broken_sidewalk',
    'street_condition',
    'traffic_signal',
    'license_plate_camera',
  ];
  const conditionId = {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    description: 'A condition_id returned by unignorable_find_nearby.',
  };

  const tools = [
    {
      name: 'unignorable_find_nearby',
      title: 'Find nearby public evidence',
      description: 'Search an NYC place for nearby recurring civic-condition evidence and mapped license plate cameras. Returns approximate public records only; it does not prove a condition is present, move the map, request location permission, or change data.',
      inputSchema: {
        type: 'object',
        properties: {
          place: { type: 'string', minLength: 3, maxLength: 180, description: 'An NYC address, intersection, landmark, or neighborhood.' },
          radius_m: { type: 'integer', minimum: 100, maximum: 5000, default: 800, description: 'Search radius in meters.' },
          categories: { type: 'array', maxItems: 7, uniqueItems: true, items: { type: 'string', enum: categories }, description: 'Optional tracked categories. Omit to search all categories.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 8, description: 'Maximum number of nearest results.' },
        },
        required: ['place'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, options) => bridge.findNearby(input, options?.signal),
    },
    {
      name: 'unignorable_inspect_condition',
      title: 'Inspect a condition lifecycle',
      description: 'Open one modeled condition on the visible map and return its dated evidence, uncertainty, Detected-to-Outcome lifecycle, permanent record, and recommended next step. Changes page view only; it does not submit, contact, purchase, or publish.',
      inputSchema: {
        type: 'object',
        properties: { condition_id: conditionId },
        required: ['condition_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input, options) => bridge.inspectCondition(input, options?.signal),
    },
    {
      name: 'unignorable_read_current_condition',
      title: 'Read the current condition',
      description: 'Read the condition, lifecycle, and map context currently selected in Unignorable without changing the page or any stored data.',
      inputSchema: emptyObjectSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => bridge.readCurrent(),
    },
    {
      name: 'unignorable_prepare_condition_action',
      title: 'Prepare a human next step',
      description: 'Open the visible UI needed for a nearby check, public share receipt, accountability record, or walking route. Preparation only: never requests geolocation, submits an observation, contacts an official, creates a receipt, starts checkout, copies text, opens a social network, or posts.',
      inputSchema: {
        type: 'object',
        properties: {
          condition_id: conditionId,
          action: {
            type: 'string',
            enum: ['nearby_check', 'share_receipt', 'accountability_record', 'walking_route'],
            description: 'The human-controlled interface to prepare.',
          },
        },
        required: ['condition_id', 'action'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input, options) => bridge.prepareAction(input, options?.signal),
    },
  ];

  Promise.all(tools.map(tool => modelContext.registerTool(tool, { signal: registration.signal })))
    .then(() => {
      const status = document.getElementById('webmcp-status');
      if (status) status.hidden = false;
      document.documentElement.dataset.webmcpTools = String(tools.length);
    })
    .catch(error => console.warn('Unignorable site tools were not registered.', error));

  window.addEventListener('pagehide', () => registration.abort(), { once: true });
})();
