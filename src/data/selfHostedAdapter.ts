import type { DataAdapter } from './adapter';

export function createSelfHostedAdapter(): DataAdapter {
  const notImplemented = (method: string): never => {
    throw new Error(
      `Self-hosted adapter not implemented in v1 (called: ${method}). ` +
        `Set VITE_DEPLOYMENT_MODE=cloud in .env.local.`,
    );
  };

  return {
    auth: {
      signUp: () => notImplemented('auth.signUp'),
      signIn: () => notImplemented('auth.signIn'),
      signOut: () => notImplemented('auth.signOut'),
      getCurrentUserId: () => notImplemented('auth.getCurrentUserId'),
      getSession: () => notImplemented('auth.getSession'),
      onAuthStateChange: () => notImplemented('auth.onAuthStateChange'),
      sendPasswordResetEmail: () => notImplemented('auth.sendPasswordResetEmail'),
      updatePassword: () => notImplemented('auth.updatePassword'),
    },
    companies: {
      list: () => notImplemented('companies.list'),
      getById: () => notImplemented('companies.getById'),
      update: () => notImplemented('companies.update'),
      uploadLogo: () => notImplemented('companies.uploadLogo'),
    },
    profiles: {
      getCurrent: () => notImplemented('profiles.getCurrent'),
    },
    onboarding: {
      createCompanyAndProfile: () => notImplemented('onboarding.createCompanyAndProfile'),
      insertCoaBatch: () => notImplemented('onboarding.insertCoaBatch'),
      insertTaxRate: () => notImplemented('onboarding.insertTaxRate'),
      insertPaymentMethod: () => notImplemented('onboarding.insertPaymentMethod'),
      insertUnit: () => notImplemented('onboarding.insertUnit'),
      insertWarehouse: () => notImplemented('onboarding.insertWarehouse'),
      insertBankAccount: () => notImplemented('onboarding.insertBankAccount'),
      getCoaByCodes: () => notImplemented('onboarding.getCoaByCodes'),
    },
    categories: {
      list: () => notImplemented('categories.list'),
      create: () => notImplemented('categories.create'),
      update: () => notImplemented('categories.update'),
      remove: () => notImplemented('categories.remove'),
    },
    brands: {
      list: () => notImplemented('brands.list'),
      create: () => notImplemented('brands.create'),
      update: () => notImplemented('brands.update'),
      remove: () => notImplemented('brands.remove'),
      uploadLogo: () => notImplemented('brands.uploadLogo'),
    },
    warehouses: {
      list: () => notImplemented('warehouses.list'),
      create: () => notImplemented('warehouses.create'),
      update: () => notImplemented('warehouses.update'),
      remove: () => notImplemented('warehouses.remove'),
    },
    units: {
      list: () => notImplemented('units.list'),
      create: () => notImplemented('units.create'),
      update: () => notImplemented('units.update'),
      remove: () => notImplemented('units.remove'),
    },
    vehicleMakes: {
      list: () => notImplemented('vehicleMakes.list'),
      create: () => notImplemented('vehicleMakes.create'),
      update: () => notImplemented('vehicleMakes.update'),
      remove: () => notImplemented('vehicleMakes.remove'),
      listModels: () => notImplemented('vehicleMakes.listModels'),
      createModel: () => notImplemented('vehicleMakes.createModel'),
      updateModel: () => notImplemented('vehicleMakes.updateModel'),
      removeModel: () => notImplemented('vehicleMakes.removeModel'),
    },
    products: {
      list: () => notImplemented('products.list'),
      search: () => notImplemented('products.search'),
      listByModel: () => notImplemented('products.listByModel'),
      getById: () => notImplemented('products.getById'),
      create: () => notImplemented('products.create'),
      update: () => notImplemented('products.update'),
      remove: () => notImplemented('products.remove'),
      uploadImage: () => notImplemented('products.uploadImage'),
      listCompatibility: () => notImplemented('products.listCompatibility'),
      addCompatibility: () => notImplemented('products.addCompatibility'),
      removeCompatibility: () => notImplemented('products.removeCompatibility'),
      listSupplierCodes: () => notImplemented('products.listSupplierCodes'),
      upsertSupplierCode: () => notImplemented('products.upsertSupplierCode'),
      removeSupplierCode: () => notImplemented('products.removeSupplierCode'),
      listPriceOverrides: () => notImplemented('products.listPriceOverrides'),
      upsertPriceOverride: () => notImplemented('products.upsertPriceOverride'),
      removePriceOverride: () => notImplemented('products.removePriceOverride'),
    },
    contacts: {
      list: () => notImplemented('contacts.list'),
      getById: () => notImplemented('contacts.getById'),
      create: () => notImplemented('contacts.create'),
      update: () => notImplemented('contacts.update'),
      remove: () => notImplemented('contacts.remove'),
    },
    priceLevels: {
      list: () => notImplemented('priceLevels.list'),
      create: () => notImplemented('priceLevels.create'),
      update: () => notImplemented('priceLevels.update'),
      remove: () => notImplemented('priceLevels.remove'),
    },
  };
}
