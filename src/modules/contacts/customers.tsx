import { ContactListPage } from './contact-list';

export default function CustomersPage() {
  return <ContactListPage defaultType="customer" titleKey="contacts.customers_title" singularKey="contacts.customer" />;
}
