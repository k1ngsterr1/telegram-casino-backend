export type CreateInvoiceDto = {
  title: string;
  description: string;
  payload: string;
  prices: { label: string; amount: number }[];
};
