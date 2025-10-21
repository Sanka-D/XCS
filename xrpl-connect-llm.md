# XRPL Connect - Integration Guide

This guide explains how to integrate and use the `xrpl-connect` package in your application.

---

## Table of Contents

1. [Installation](#installation)
2. [Basic Setup](#basic-setup)
3. [Framework Integration](#framework-integration)
4. [Core Concepts](#core-concepts)
5. [Common Use Cases](#common-use-cases)
6. [Configuration Options](#configuration-options)
7. [Event Handling](#event-handling)
8. [Error Handling](#error-handling)
9. [TypeScript Support](#typescript-support)
10. [Best Practices](#best-practices)

---

## Installation

### Prerequisites

- Node.js 14+ or browser environment with ES2020+ support
- `xrpl` package (v3.0.0 or v4.0.0)

### Install the Package

```bash
npm install xrpl-connect xrpl
# or
yarn add xrpl-connect xrpl
# or
pnpm add xrpl-connect xrpl
```

### Import in Your Project

```typescript
import { WalletManager, XamanAdapter, CrossmarkAdapter } from 'xrpl-connect';
```

---

## Basic Setup

### 1. Create a WalletManager Instance

```typescript
import { WalletManager, Adapters } from 'xrpl-connect';

const walletManager = new WalletManager({
  adapters: [
    new Adapters.Xaman(),
    new Adapters.Crossmark(),
    new Adapters.GemWallet(),
    new Adapters.WalletConnect({ projectId: 'your-project-id' }),
  ],
  network: 'testnet', // 'mainnet', 'testnet', or 'devnet'
  autoConnect: true, // Auto-reconnect on page load
  logger: { level: 'debug' }, // Optional: enable logging
});
```

### 2. Add the Web Component to HTML

```html
<button id="connect-btn">Connect Wallet</button>

<xrpl-wallet-connector
  id="wallet-connector"
  background-color="#1a202c"
  text-color="#F5F4E7"
  primary-color="#0ea5e9"
  primary-wallet="xaman"
  font-family="'Inter', sans-serif"
>
</xrpl-wallet-connector>
```

### 3. Connect Manager to UI

```typescript
const connector = document.getElementById('wallet-connector');
connector.setWalletManager(walletManager);

// Open modal on button click
document.getElementById('connect-btn').addEventListener('click', () => {
  connector.open();
});
```

### 4. Listen to Connection Events

```typescript
walletManager.on('connect', (account) => {
  console.log('Connected to wallet:', account.address);
  console.log('Network:', account.network.name);
  // Update UI with connected state
});

walletManager.on('disconnect', () => {
  console.log('Wallet disconnected');
  // Update UI with disconnected state
});

walletManager.on('error', (error) => {
  console.error('Wallet error:', error.message);
});
```

---

## Framework Integration

### Vanilla JavaScript

**Complete Example:**

```html
<!DOCTYPE html>
<html>
  <head>
    <title>XRPL Connect Demo</title>
  </head>
  <body>
    <div id="app">
      <button id="connect-btn">Connect Wallet</button>
      <p id="status">Not connected</p>
      <button id="sign-btn" disabled>Sign Transaction</button>
    </div>

    <xrpl-wallet-connector id="wallet-connector"></xrpl-wallet-connector>

    <script type="module">
      import { WalletManager, Adapters } from 'xrpl-connect';

      // Initialize wallet manager
      const walletManager = new WalletManager({
        adapters: [new Adapters.Xaman(), new Adapters.Crossmark()],
        network: 'testnet',
        autoConnect: true,
      });

      // Connect UI
      const connector = document.getElementById('wallet-connector');
      connector.setWalletManager(walletManager);

      // Event listeners
      walletManager.on('connect', (account) => {
        document.getElementById('status').textContent =
          `Connected: ${account.address}`;
        document.getElementById('sign-btn').disabled = false;
      });

      walletManager.on('disconnect', () => {
        document.getElementById('status').textContent = 'Not connected';
        document.getElementById('sign-btn').disabled = true;
      });

      // Connect button
      document.getElementById('connect-btn').addEventListener('click', () => {
        connector.open();
      });

      // Sign button
      document
        .getElementById('sign-btn')
        .addEventListener('click', async () => {
          if (!walletManager.connected) return;

          const tx = {
            TransactionType: 'Payment',
            Account: walletManager.account.address,
            Destination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXoQT',
            Amount: '1000000',
          };

          try {
            const signed = await walletManager.sign(tx);
            console.log('Transaction signed:', signed.hash);
          } catch (error) {
            console.error('Sign failed:', error);
          }
        });
    </script>
  </body>
</html>
```

### React

**Hook Pattern (Recommended):**

```typescript
import { useEffect, useRef, useState } from 'react';
import { WalletManager, Adapters } from 'xrpl-connect';

function useWalletManager() {
  const managerRef = useRef(null);
  const [account, setAccount] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Initialize wallet manager
    const manager = new WalletManager({
      adapters: [
        new Adapters.Xaman(),
        new Adapters.Crossmark(),
      ],
      network: 'testnet',
      autoConnect: true,
    });

    managerRef.current = manager;

    // Setup event listeners
    manager.on('connect', (acc) => {
      setAccount(acc);
      setConnected(true);
      setError(null);
    });

    manager.on('disconnect', () => {
      setAccount(null);
      setConnected(false);
    });

    manager.on('error', (err) => {
      setError(err.message);
    });

    return () => {
      // Cleanup if needed
    };
  }, []);

  return {
    manager: managerRef.current,
    account,
    connected,
    error,
  };
}

// Component using the hook
function WalletButton() {
  const { manager, account, connected } = useWalletManager();
  const connectorRef = useRef(null);

  useEffect(() => {
    if (connectorRef.current && manager) {
      connectorRef.current.setWalletManager(manager);
    }
  }, [manager]);

  const handleClick = () => {
    connectorRef.current?.open();
  };

  return (
    <>
      <button onClick={handleClick}>
        {connected ? `${account.address.slice(0, 6)}...` : 'Connect'}
      </button>
      <xrpl-wallet-connector ref={connectorRef} />
    </>
  );
}
```

**Context Provider Pattern:**

```typescript
import { createContext, useContext, useRef, useEffect, useState } from 'react';
import { WalletManager, Adapters } from 'xrpl-connect';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const managerRef = useRef(null);
  const [state, setState] = useState({
    account: null,
    connected: false,
    error: null,
  });

  useEffect(() => {
    const manager = new WalletManager({
      adapters: [
        new Adapters.Xaman(),
        new Adapters.Crossmark(),
      ],
      network: 'testnet',
      autoConnect: true,
    });

    managerRef.current = manager;

    manager.on('connect', (account) => {
      setState(prev => ({
        ...prev,
        account,
        connected: true,
        error: null,
      }));
    });

    manager.on('disconnect', () => {
      setState(prev => ({
        ...prev,
        account: null,
        connected: false,
      }));
    });

    manager.on('error', (error) => {
      setState(prev => ({
        ...prev,
        error: error.message,
      }));
    });

    return () => manager.disconnect?.();
  }, []);

  return (
    <WalletContext.Provider value={{ manager: managerRef.current, ...state }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
}

// Usage in components
function MyComponent() {
  const { manager, account, connected } = useWallet();

  const handleSign = async () => {
    const signed = await manager.sign({
      TransactionType: 'Payment',
      Account: account.address,
      Destination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXoQT',
      Amount: '1000000',
    });
    console.log('Signed:', signed);
  };

  return (
    <div>
      {connected && <button onClick={handleSign}>Sign</button>}
    </div>
  );
}
```

### Vue 3

**Composable Pattern:**

```typescript
// useWallet.js
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { WalletManager, Adapters } from 'xrpl-connect';

export function useWallet() {
  const manager = ref(null);
  const account = ref(null);
  const connected = ref(false);
  const error = ref(null);

  onMounted(() => {
    manager.value = new WalletManager({
      adapters: [new Adapters.Xaman(), new Adapters.Crossmark()],
      network: 'testnet',
      autoConnect: true,
    });

    manager.value.on('connect', (acc) => {
      account.value = acc;
      connected.value = true;
      error.value = null;
    });

    manager.value.on('disconnect', () => {
      account.value = null;
      connected.value = false;
    });

    manager.value.on('error', (err) => {
      error.value = err.message;
    });
  });

  const sign = async (transaction) => {
    if (!manager.value) throw new Error('Wallet not ready');
    return manager.value.sign(transaction);
  };

  const signMessage = async (message) => {
    if (!manager.value) throw new Error('Wallet not ready');
    return manager.value.signMessage(message);
  };

  const disconnect = async () => {
    if (!manager.value) return;
    await manager.value.disconnect();
  };

  return {
    manager,
    account,
    connected,
    error,
    sign,
    signMessage,
    disconnect,
  };
}
```

**Component Using Composable:**

```vue
<template>
  <div>
    <button v-if="!connected" @click="openConnector">Connect Wallet</button>
    <div v-else>
      <p>Connected: {{ account?.address }}</p>
      <button @click="handleSign">Sign Transaction</button>
    </div>

    <xrpl-wallet-connector
      ref="connectorRef"
      @setWalletManager="onSetManager"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useWallet } from './useWallet';

const { manager, account, connected, sign } = useWallet();
const connectorRef = ref(null);

onMounted(() => {
  if (connectorRef.value && manager.value) {
    connectorRef.value.setWalletManager(manager.value);
  }
});

const openConnector = () => {
  connectorRef.value?.open();
};

const handleSign = async () => {
  const tx = {
    TransactionType: 'Payment',
    Account: account.value.address,
    Destination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXoQT',
    Amount: '1000000',
  };

  const signed = await sign(tx);
  console.log('Signed:', signed);
};
</script>
```

---

## Core Concepts

### WalletManager

The main class that orchestrates wallet connections and operations.

```typescript
// Create instance
const manager = new WalletManager({
  adapters: [new Adapters.Xaman()],
  network: 'testnet',
  autoConnect: true,
});

// Connect to a wallet
const account = await manager.connect('xaman');

// Check connection state
if (manager.connected) {
  console.log('Current account:', manager.account);
  console.log('Current wallet:', manager.wallet);
}

// Sign operations
const signed = await manager.sign(transaction);
const signedMessage = await manager.signMessage('Hello XRPL');

// Disconnect
await manager.disconnect();
```

### Wallet Adapters

Each adapter handles a specific wallet.

```typescript
import { Adapters } from 'xrpl-connect';

// Create adapters
const xaman = new Adapters.Xaman();
const crossmark = new Adapters.Crossmark();
const gemWallet = new Adapters.GemWallet();
const walletConnect = new Adapters.WalletConnect({
  projectId: 'your-walletconnect-project-id',
});

// Check if available
const available = await xaman.isAvailable();

// Use directly (advanced)
const account = await xaman.connect();
const signed = await xaman.sign(transaction);
```

### Networks

Supported networks and configuration.

```typescript
import { STANDARD_NETWORKS } from 'xrpl-connect';

// Standard networks
console.log(STANDARD_NETWORKS.mainnet);   // { id: 'mainnet', ... }
console.log(STANDARD_NETWORKS.testnet);   // { id: 'testnet', ... }
console.log(STANDARD_NETWORKS.devnet);    // { id: 'devnet', ... }

// Create custom network
const customNetwork = {
  id: 'custom',
  name: 'Custom Network',
  wss: 'wss://your-custom-endpoint.com',
  rpc: 'https://your-custom-endpoint.com',
};

// Use in manager
const manager = new WalletManager({
  adapters: [...],
  network: customNetwork,
});
```

---

## Common Use Cases

### Use Case 1: Connect and Get Account Info

```typescript
import { WalletManager, Adapters } from 'xrpl-connect';

const manager = new WalletManager({
  adapters: [new Adapters.Xaman(), new Adapters.Crossmark()],
  network: 'testnet',
});

// Connect programmatically
const account = await manager.connect('xaman');

console.log(account.address); // 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXoQT'
console.log(account.network.id); // 'testnet'
console.log(account.publicKey); // Optional, depends on adapter
```

### Use Case 2: Sign a Payment Transaction

```typescript
const tx = {
  TransactionType: 'Payment',
  Account: manager.account.address,
  Destination: 'rU6K7V3Po4snVhBBaU29sesqs2qTQJWDw1',
  Amount: '1000000', // 1 XRP in drops
  Fee: '12',
};

try {
  const signed = await manager.sign(tx);
  console.log('Hash:', signed.hash);
  console.log('Blob:', signed.tx_blob);
} catch (error) {
  console.error('Sign failed:', error);
}
```

### Use Case 3: Sign a Message (for authentication)

```typescript
const message = 'Sign to verify ownership';

const signed = await manager.signMessage(message);

console.log(signed.message); // Original message
console.log(signed.signature); // Signature hex
console.log(signed.publicKey); // Signer's public key

// Verify on server side using xrpl-lib utilities
```

### Use Case 4: Handle Multiple Wallets

```typescript
const manager = new WalletManager({
  adapters: [
    new Adapters.Xaman(),
    new Adapters.Crossmark(),
    new Adapters.GemWallet(),
    new Adapters.WalletConnect(),
  ],
});

// Get available wallets
const available = await manager.getAvailableWallets();
console.log(available.map((w) => w.name));

// Connect to specific wallet
const account = await manager.connect('crossmark');

// Reconnect (remembers last wallet if autoConnect)
const restored = await manager.reconnect();
```

### Use Case 5: Track Account Changes

```typescript
manager.on('accountChanged', (newAccount) => {
  console.log('User switched account:', newAccount.address);
  // Update UI with new account info
  // Cancel pending operations if needed
});

manager.on('networkChanged', (newNetwork) => {
  console.log('User switched network:', newNetwork.name);
  // Update UI
  // Potentially restart operations on new network
});
```

### Use Case 6: Auto-reconnect on Page Load

```typescript
const manager = new WalletManager({
  adapters: [...],
  autoConnect: true,  // Enable auto-reconnect
});

// If user was previously connected, they'll automatically reconnect
manager.on('connect', (account) => {
  console.log('Auto-reconnected to:', account.address);
});
```

### Use Case 7: Custom Storage

```typescript
import { WalletManager, MemoryStorageAdapter } from 'xrpl-connect';

// Use memory storage instead of localStorage (useful for SSR, testing)
const manager = new WalletManager({
  adapters: [...],
  storage: new MemoryStorageAdapter(),
});

// Or implement custom storage
class CustomStorage {
  async get(key) { /* ... */ }
  async set(key, value) { /* ... */ }
  async remove(key) { /* ... */ }
  async clear() { /* ... */ }
}

const manager = new WalletManager({
  adapters: [...],
  storage: new CustomStorage(),
});
```

---

## Configuration Options

### WalletManager Options

```typescript
interface WalletManagerOptions {
  // Required: Array of wallet adapters
  adapters: WalletAdapter[];

  // Optional: Default network ('mainnet' | 'testnet' | 'devnet' | NetworkInfo)
  network?: NetworkConfig;

  // Optional: Auto-reconnect to last connected wallet on init
  autoConnect?: boolean;

  // Optional: Custom storage implementation
  storage?: StorageAdapter;

  // Optional: Logging configuration
  logger?: LoggerOptions;
}

// Example
const manager = new WalletManager({
  adapters: [new Adapters.Xaman()],
  network: 'mainnet',
  autoConnect: true,
  logger: { level: 'debug' },
});
```

### Logger Options

```typescript
interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error' | 'none';
  prefix?: string;
}

// Example
const manager = new WalletManager({
  adapters: [...],
  logger: {
    level: 'debug',
    prefix: '[MyApp]',
  },
});

// Output: [MyApp] [DEBUG] Connecting to wallet...
```

### Web Component Attributes

```html
<xrpl-wallet-connector
  id="wallet-connector"
  background-color="#1a202c"
  text-color="#F5F4E7"
  primary-color="#0ea5e9"
  primary-wallet="xaman"
  font-family="'Inter', sans-serif"
>
</xrpl-wallet-connector>
```

**Available attributes:**

- `background-color` - Modal background color (hex)
- `text-color` - Text color (hex)
- `primary-color` - Accent/button color (hex)
- `primary-wallet` - Wallet to highlight first (adapter ID)
- `font-family` - CSS font family

---

## Event Handling

### Available Events

```typescript
// Connection events
manager.on('connect', (account: AccountInfo) => {
  // User connected
});

manager.on('disconnect', () => {
  // User disconnected
});

// Change events
manager.on('accountChanged', (newAccount: AccountInfo) => {
  // User switched accounts
});

manager.on('networkChanged', (newNetwork: NetworkInfo) => {
  // User switched networks
});

// Error event
manager.on('error', (error: WalletError) => {
  // Error occurred
});
```

### Event Patterns

```typescript
// One-time listener
manager.once('connect', (account) => {
  console.log('Connected!');
  // This will only run once
});

// Remove listener
const handler = (account) => console.log(account);
manager.on('connect', handler);
manager.off('connect', handler);

// Check current state
if (manager.connected) {
  console.log(manager.account);
}
```

### Event Flow Example

```typescript
const manager = new WalletManager({ adapters: [...] });

manager.on('connect', (account) => {
  console.log('1. Connected:', account.address);
});

manager.on('accountChanged', (newAccount) => {
  console.log('2. Account changed:', newAccount.address);
});

manager.on('networkChanged', (newNetwork) => {
  console.log('3. Network changed:', newNetwork.name);
});

manager.on('disconnect', () => {
  console.log('4. Disconnected');
});

manager.on('error', (error) => {
  console.log('5. Error:', error.message);
});

// User flow:
// - Clicks "Connect" → connect event fires
// - Switches account in wallet → accountChanged event fires
// - Switches network in wallet → networkChanged event fires
// - Clicks "Disconnect" → disconnect event fires
```

---

## Error Handling

### Error Types

```typescript
import { WalletError, WalletErrorCode, isWalletError } from 'xrpl-connect';

try {
  await manager.sign(tx);
} catch (error) {
  if (isWalletError(error)) {
    // It's a WalletError
    console.log(error.code); // Error code enum
    console.log(error.message); // User-friendly message
    console.log(error.originalError); // Original error if available

    // Handle specific errors
    switch (error.code) {
      case WalletErrorCode.WALLET_NOT_FOUND:
        console.log('Wallet not installed');
        break;
      case WalletErrorCode.CONNECTION_REJECTED:
        console.log('User rejected connection');
        break;
      case WalletErrorCode.SIGN_REJECTED:
        console.log('User rejected signature');
        break;
      case WalletErrorCode.NOT_CONNECTED:
        console.log('Wallet not connected');
        break;
      default:
        console.log('Unknown error');
    }
  } else {
    // It's some other error
    console.error('Unknown error:', error);
  }
}
```

### Error Codes

```typescript
enum WalletErrorCode {
  // Connection errors
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  WALLET_NOT_INSTALLED = 'WALLET_NOT_INSTALLED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_REJECTED = 'CONNECTION_REJECTED',

  // Signing errors
  SIGN_FAILED = 'SIGN_FAILED',
  SIGN_REJECTED = 'SIGN_REJECTED',

  // Network errors
  NETWORK_NOT_SUPPORTED = 'NETWORK_NOT_SUPPORTED',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',

  // State errors
  NOT_CONNECTED = 'NOT_CONNECTED',
  ALREADY_CONNECTED = 'ALREADY_CONNECTED',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
```

### Error Handling Best Practices

```typescript
// Good: Specific error handling
async function signTransaction(tx) {
  try {
    return await manager.sign(tx);
  } catch (error) {
    if (error.code === WalletErrorCode.SIGN_REJECTED) {
      // Show "User rejected" message
      showToast('User rejected the signature');
    } else if (error.code === WalletErrorCode.NOT_CONNECTED) {
      // Show "Connect first" message
      showToast('Please connect wallet first');
    } else {
      // Show generic error with details
      showToast(`Error: ${error.message}`);
    }
    throw error;
  }
}

// Good: Event error handler
manager.on('error', (error) => {
  console.error('Wallet error:', error.code, error.message);
  // Could also send to error tracking service
});
```

---

## TypeScript Support

### Type-Safe Wallet Adapter

```typescript
import {
  WalletAdapter,
  WalletManager,
  AccountInfo,
  Transaction,
  SignedTransaction,
} from 'xrpl-connect';

// Type the manager
const manager: WalletManager = new WalletManager({
  adapters: [...],
});

// Type returned values
const account: AccountInfo = await manager.connect('xaman');
console.log(account.address);      // ✓ autocomplete
console.log(account.network.id);   // ✓ autocomplete

// Type transaction
const tx: Transaction = {
  TransactionType: 'Payment',
  Account: manager.account.address,
  Destination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfXoQT',
  Amount: '1000000',
};

// Type signed result
const signed: SignedTransaction = await manager.sign(tx);
console.log(signed.hash);          // ✓ autocomplete
```

### Event Type Safety

```typescript
import { WalletEvent, AccountInfo } from 'xrpl-connect';

// Properly typed event listener
manager.on('connect', (account: AccountInfo) => {
  // account is typed as AccountInfo
  console.log(account.address); // ✓ autocomplete
});

manager.on('error', (error: any) => {
  // error handling
});
```

### Custom Adapter Types

```typescript
import { WalletAdapter, ConnectOptions, AccountInfo } from 'xrpl-connect';

// Implement custom adapter with full types
class MyCustomAdapter implements WalletAdapter {
  readonly id = 'my-adapter';
  readonly name = 'My Adapter';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async connect(options?: ConnectOptions): Promise<AccountInfo> {
    // Implementation with proper typing
    return {
      address: 'rXXX',
      network: { id: 'testnet', name: 'Testnet', wss: '...' },
    };
  }

  // ... other methods
}
```

---

## Best Practices

### 1. Initialize Early

Initialize the WalletManager at the top level of your app, not on every page/component.

```typescript
// ✓ Good
const manager = new WalletManager({
  /* ... */
});
// Make available globally or via context

// ✗ Bad
function SomeComponent() {
  const manager = new WalletManager({
    /* ... */
  }); // Creates new instance on every render
}
```

### 2. Use Event Listeners for State

Listen to events rather than polling state.

```typescript
// ✓ Good
manager.on('connect', (account) => {
  updateUI(account);
});

// ✗ Bad
setInterval(() => {
  if (manager.connected) {
    updateUI(manager.account);
  }
}, 1000);
```

### 3. Enable AutoConnect in Production

Let users stay connected across page reloads.

```typescript
// ✓ Good for user experience
const manager = new WalletManager({
  adapters: [...],
  autoConnect: true,
});

// ✗ Requires user to connect on every page load
const manager = new WalletManager({
  adapters: [...],
  autoConnect: false,
});
```

### 4. Handle All Error Cases

Be ready for connection, signing, and network errors.

```typescript
// ✓ Good
async function handleSign() {
  try {
    const signed = await manager.sign(tx);
    return signed;
  } catch (error) {
    if (isWalletError(error)) {
      // Specific handling
      handleWalletError(error);
    } else {
      // Unknown error
      console.error('Unexpected error:', error);
    }
  }
}
```

### 5. Provide UI Feedback

Show users what's happening during wallet operations.

```typescript
// ✓ Good - provides feedback
async function connectWallet() {
  showLoading();
  try {
    const account = await manager.connect('xaman');
    showSuccess(`Connected: ${account.address}`);
  } catch (error) {
    showError(`Connection failed: ${error.message}`);
  } finally {
    hideLoading();
  }
}
```

### 6. Clean Up on Unmount

In frameworks, clean up listeners when components unmount.

```typescript
// React example
useEffect(() => {
  const handleConnect = (account) => {
    /* ... */
  };

  manager.on('connect', handleConnect);

  return () => {
    manager.off('connect', handleConnect); // Cleanup
  };
}, []);
```

### 7. Store Only Address, Not Full Account

Store the address in state/database; fetch account info from wallet when needed.

```typescript
// ✓ Good - flexible if user switches wallets
const [address, setAddress] = useState(null);

manager.on('connect', (account) => {
  setAddress(account.address); // Only store address
});

// ✗ Bad - tightly coupled to specific wallet
const [account, setAccount] = useState(null);
```

### 8. Use Typed Transactions

Define transaction types for common operations.

```typescript
// ✓ Good - reusable, type-safe
interface PaymentTx extends Transaction {
  TransactionType: 'Payment';
  Account: string;
  Destination: string;
  Amount: string;
  Fee?: string;
}

const payment: PaymentTx = {
  TransactionType: 'Payment',
  Account: manager.account.address,
  Destination: 'rXXX',
  Amount: '1000000',
};
```

### 9. Validate Network Match

Check that user is on the correct network before signing.

```typescript
// ✓ Good - prevents user mistakes
if (manager.account.network.id !== 'mainnet') {
  throw new Error('Please switch to mainnet');
}

const signed = await manager.sign(tx);
```

### 10. Log Important Events

For debugging and monitoring in production.

```typescript
// ✓ Good - helps with troubleshooting
manager.on('connect', (account) => {
  console.log(`[${new Date().toISOString()}] Connected to ${account.address}`);
  // Could also send to analytics/logging service
});

manager.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] Error: ${error.code}`);
  // Send to error tracking (Sentry, LogRocket, etc.)
});
```

---

## Troubleshooting

### Issue: Wallet Connection Button Does Not Appear

**Solution**: Ensure the web component is properly imported and the HTML element is in the DOM.

```typescript
// Make sure to import the UI
import { WalletManager } from 'xrpl-connect';

// Web component is auto-registered, just use it
const connector = document.getElementById('wallet-connector');
connector.setWalletManager(manager);
```

### Issue: Auto-Connect Not Working

**Solution**: Ensure autoConnect is enabled and you've previously connected.

```typescript
const manager = new WalletManager({
  adapters: [...],
  autoConnect: true,  // Must be true
});

// Auto-connect only works if user previously connected
// First time users won't auto-connect
```

### Issue: Can't Connect to WalletConnect

**Solution**: Make sure you provide a valid WalletConnect project ID.

```typescript
// ✗ Wrong
new Adapters.WalletConnect();

// ✓ Correct
new Adapters.WalletConnect({ projectId: 'your-project-id' });
```

Get a project ID at: https://cloud.walletconnect.com

### Issue: Sign Fails with "Not Connected"

**Solution**: Check connection state before signing.

```typescript
// ✓ Good
if (!manager.connected) {
  throw new Error('Please connect wallet first');
}

const signed = await manager.sign(tx);
```

### Issue: TypeScript Errors with Web Component

**Solution**: The web component might not be recognized. Add declaration file.

```typescript
// web-components.d.ts
declare namespace JSX {
  interface IntrinsicElements {
    'xrpl-wallet-connector': any;
  }
}
```

---

## Next Steps

- Check `llm.md` for package architecture
- Review individual adapter documentation for adapter-specific options
- Explore example implementations in the repository
- Check XRPL documentation for transaction types and signing

---

_Last updated: 2025-10-21_
_Package Version: 0.1.4_
