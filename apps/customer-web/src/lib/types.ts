export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  cafe_id: string;
}

export interface LoginResponse {
  access_token: string;
  user: AuthUserDto;
}

export interface MenuItemDto {
  id: string;
  name: string;
  price_amount: number;
  available: boolean;
  prep_minutes: number;
}

export interface MenuCategoryDto {
  id: string;
  name: string;
  items: MenuItemDto[];
}
