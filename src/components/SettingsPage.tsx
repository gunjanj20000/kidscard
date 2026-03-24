import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Edit3, Check, X, Upload, Download, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import type { Category, Flashcard, AppSettings } from '@/types/flashcard';
import type { Models } from 'appwrite';

interface SettingsPageProps {
  categories: Category[];
  cards: Flashcard[];
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  onAddCard: (card: Omit<Flashcard, 'id'>) => void;
  onUpdateCard: (id: string, updates: Partial<Omit<Flashcard, 'id'>>) => void;
  onDeleteCard: (id: string) => void;
  onAddCategory: (category: Omit<Category, 'id'>) => void;
  onUpdateCategory: (id: string, updates: Partial<Omit<Category, 'id'>>) => void;
  onDeleteCategory: (id: string) => void;
  onCreateLocalBackup: () => Promise<unknown>;
  onRestoreLocalBackup: (backup: unknown) => Promise<{ categories: number; cards: number }>;
  currentUser: Models.User<Models.Preferences> | null;
  onLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  onSignup: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  onLogout: () => Promise<{ success: boolean; error?: string }>;
  onSyncNow: () => Promise<{ success: boolean; error?: string; syncedCards?: number; syncedCategories?: number }>;
  onBack: () => void;
}

type Tab = 'cards' | 'categories' | 'settings' | 'account';

const colorOptions: Category['color'][] = ['coral', 'mint', 'sky', 'lavender', 'sunshine', 'peach'];
const emojiOptions = ['🐾', '🎨', '🔢', '🍎', '⭐', '🌸', '🎵', '🚗', '🏠', '📚', '🎮', '⚽'];

export function SettingsPage({
  categories,
  cards,
  settings,
  onUpdateSettings,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onCreateLocalBackup,
  onRestoreLocalBackup,
  currentUser,
  onLogin,
  onSignup,
  onLogout,
  onSyncNow,
  onBack,
}: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('cards');
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // New card form state
  const [newCardWord, setNewCardWord] = useState('');
  const [newCardImage, setNewCardImage] = useState('');
  const [newCardCategory, setNewCardCategory] = useState(categories[0]?.id || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);
  const [isBackupBusy, setIsBackupBusy] = useState(false);

  // Account form state
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);

  // Edit card form state
  const [editCardWord, setEditCardWord] = useState('');
  const [editCardImage, setEditCardImage] = useState('');
  const [editCardCategory, setEditCardCategory] = useState('');

  // New category form state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState(emojiOptions[0]);
  const [newCategoryColor, setNewCategoryColor] = useState<Category['color']>('coral');

  // Edit category form state
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryIcon, setEditCategoryIcon] = useState('');
  const [editCategoryColor, setEditCategoryColor] = useState<Category['color']>('coral');

  const handleAddCard = () => {
    if (newCardWord.trim() && newCardImage.trim() && newCardCategory) {
      onAddCard({
        word: newCardWord.trim(),
        imageUrl: newCardImage.trim(),
        categoryId: newCardCategory,
      });
      setNewCardWord('');
      setNewCardImage('');
      setIsAddingCard(false);
    }
  };

  const handleStartEditCard = (card: Flashcard) => {
    setEditingCardId(card.id);
    setEditCardWord(card.word);
    setEditCardImage(card.imageUrl);
    setEditCardCategory(card.categoryId);
  };

  const handleSaveEditCard = () => {
    if (editingCardId && editCardWord.trim() && editCardImage.trim()) {
      onUpdateCard(editingCardId, {
        word: editCardWord.trim(),
        imageUrl: editCardImage.trim(),
        categoryId: editCardCategory,
      });
      setEditingCardId(null);
    }
  };

  const handleCancelEditCard = () => {
    setEditingCardId(null);
    setEditCardWord('');
    setEditCardImage('');
    setEditCardCategory('');
  };

  const handleAddCategory = () => {
    if (newCategoryName.trim()) {
      onAddCategory({
        name: newCategoryName.trim(),
        icon: newCategoryIcon,
        color: newCategoryColor,
      });
      setNewCategoryName('');
      setNewCategoryIcon(emojiOptions[0]);
      setNewCategoryColor('coral');
      setIsAddingCategory(false);
    }
  };

  const handleStartEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditCategoryName(category.name);
    setEditCategoryIcon(category.icon);
    setEditCategoryColor(category.color);
  };

  const handleSaveEditCategory = () => {
    if (editingCategoryId && editCategoryName.trim()) {
      onUpdateCategory(editingCategoryId, {
        name: editCategoryName.trim(),
        icon: editCategoryIcon,
        color: editCategoryColor,
      });
      setEditingCategoryId(null);
    }
  };

  const handleCancelEditCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryName('');
    setEditCategoryIcon('');
    setEditCategoryColor('coral');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewCardImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEditImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditCardImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackup = async () => {
    if (isBackupBusy) return;

    setIsBackupBusy(true);
    try {
      const backupData = await onCreateLocalBackup();
      const backupJson = JSON.stringify(backupData, null, 2);
      const blob = new Blob([backupJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `kids-cards-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success('Backup saved to this device');
    } catch (error) {
      console.error('Backup failed:', error);
      toast.error('Backup failed');
    } finally {
      setIsBackupBusy(false);
    }
  };

  const handleRestoreFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isBackupBusy) return;

    setIsBackupBusy(true);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      const result = await onRestoreLocalBackup(parsed);
      toast.success(`Restored ${result.cards} cards in ${result.categories} categories`);
    } catch (error) {
      console.error('Restore failed:', error);
      toast.error(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = '';
      }
      setIsBackupBusy(false);
    }
  };

  const getCardCountForCategory = (categoryId: string) =>
    cards.filter((c) => c.categoryId === categoryId).length;

  const handleAccountSubmit = async () => {
    const email = accountEmail.trim();
    const password = accountPassword.trim();

    if (!email || !password) {
      toast.error('Please enter email and password');
      return;
    }

    if (authMode === 'signup' && !accountName.trim()) {
      toast.error('Please enter your name');
      return;
    }

    if (authMode === 'signup' && password.length < 6) {
      toast.error('Password should be at least 6 characters');
      return;
    }

    if (authMode === 'signup' && password !== confirmPassword.trim()) {
      toast.error('Passwords do not match');
      return;
    }

    setIsAuthBusy(true);

    const result = authMode === 'login'
      ? await onLogin(email, password)
      : await onSignup(accountName.trim(), email, password);

    setIsAuthBusy(false);

    if (!result.success) {
      toast.error(result.error ?? (authMode === 'login' ? 'Login failed' : 'Sign up failed'));
      return;
    }

    toast.success(authMode === 'login' ? 'Logged in successfully' : 'Account created successfully');
    setAccountPassword('');
    setConfirmPassword('');
  };

  const handleLogout = async () => {
    setIsAuthBusy(true);
    const result = await onLogout();
    setIsAuthBusy(false);

    if (!result.success) {
      toast.error(result.error ?? 'Logout failed');
      return;
    }

    toast.success('Logged out successfully');
  };

  return (
    <div className="h-[100dvh] bg-background p-4 pb-4 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 mb-3 shrink-0">
        <motion.button
          onClick={onBack}
          className="w-12 h-12 bg-card rounded-2xl card-shadow flex items-center justify-center"
          whileTap={{ scale: 0.95 }}
        >
          <ArrowLeft className="w-6 h-6" />
        </motion.button>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 mb-3 bg-muted p-1 rounded-2xl shrink-0 sticky top-0 z-10">
        {(['cards', 'categories', 'settings', 'account'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-2 px-2 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap ${
              activeTab === tab
                ? 'bg-card card-shadow text-foreground'
                : 'text-muted-foreground'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">

      {/* Cards Tab */}
      {activeTab === 'cards' && (
        <div className="h-full flex flex-col gap-3 min-h-0">
          <Button
            onClick={() => setIsAddingCard(true)}
            className="w-full h-12 bg-primary text-primary-foreground rounded-2xl font-semibold text-base"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add New Card
          </Button>

          {isAddingCard && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl p-3 card-shadow space-y-3 shrink-0"
            >
              <Input
                placeholder="Word (e.g., Cat)"
                value={newCardWord}
                onChange={(e) => setNewCardWord(e.target.value)}
                className="h-12 rounded-xl text-lg"
              />

              <div className="flex gap-2">
                <Input
                  placeholder="Image URL"
                  value={newCardImage}
                  onChange={(e) => setNewCardImage(e.target.value)}
                  className="h-12 rounded-xl flex-1"
                />
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-12 px-4 rounded-xl"
                >
                  <Upload className="w-5 h-5" />
                </Button>
              </div>

              {newCardImage && (
                <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gradient-to-br from-purple-400 via-pink-400 to-blue-400 flex items-center justify-center">
                  <img src={newCardImage} alt="Preview" className="w-full h-full object-contain" />
                </div>
              )}

              <select
                value={newCardCategory}
                onChange={(e) => setNewCardCategory(e.target.value)}
                className="w-full h-12 rounded-xl border border-input bg-card px-4 text-lg"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <Button
                  onClick={handleAddCard}
                  className="flex-1 h-12 bg-secondary text-secondary-foreground rounded-xl font-semibold"
                >
                  <Check className="w-5 h-5 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsAddingCard(false)}
                  className="h-12 px-6 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Card List */}
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 content-start overflow-y-auto pr-1">
            {cards.map((card) => {
              const category = categories.find((c) => c.id === card.categoryId);
              const isEditing = editingCardId === card.id;

              if (isEditing) {
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-card rounded-2xl p-4 card-shadow space-y-4"
                  >
                    <Input
                      placeholder="Word"
                      value={editCardWord}
                      onChange={(e) => setEditCardWord(e.target.value)}
                      className="h-12 rounded-xl text-lg"
                    />

                    <div className="flex gap-2">
                      <Input
                        placeholder="Image URL"
                        value={editCardImage}
                        onChange={(e) => setEditCardImage(e.target.value)}
                        className="h-12 rounded-xl flex-1"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        ref={editFileInputRef}
                        onChange={handleEditImageUpload}
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        onClick={() => editFileInputRef.current?.click()}
                        className="h-12 px-4 rounded-xl"
                      >
                        <Upload className="w-5 h-5" />
                      </Button>
                    </div>

                    {editCardImage && (
                      <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gradient-to-br from-purple-400 via-pink-400 to-blue-400 flex items-center justify-center">
                        <img src={editCardImage} alt="Preview" className="w-full h-full object-contain" />
                      </div>
                    )}

                    <select
                      value={editCardCategory}
                      onChange={(e) => setEditCardCategory(e.target.value)}
                      className="w-full h-12 rounded-xl border border-input bg-card px-4 text-lg"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.icon} {cat.name}
                        </option>
                      ))}
                    </select>

                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveEditCard}
                        className="flex-1 h-12 bg-secondary text-secondary-foreground rounded-xl font-semibold"
                      >
                        <Check className="w-5 h-5 mr-2" />
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleCancelEditCard}
                        className="h-12 px-6 rounded-xl"
                      >
                        <X className="w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                );
              }

              return (
                <Card key={card.id} className="p-3 rounded-2xl flex items-center gap-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-purple-400 via-pink-400 to-blue-400 flex-shrink-0 flex items-center justify-center">
                    <img src={card.imageUrl} alt={card.word} className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg truncate">
                      {card.word}{' '}
                      <span className="text-xs font-medium text-muted-foreground normal-case">
                        ({(category?.name ?? 'uncategorized').toLowerCase()})
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={() => handleStartEditCard(card)}
                    className="w-10 h-10 rounded-xl bg-sky/20 flex items-center justify-center"
                  >
                    <Edit3 className="w-5 h-5 text-sky" />
                  </button>
                  <button
                    onClick={() => onDeleteCard(card.id)}
                    className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center"
                  >
                    <Trash2 className="w-5 h-5 text-destructive" />
                  </button>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="h-full flex flex-col gap-3 min-h-0">
          <Button
            onClick={() => setIsAddingCategory(true)}
            className="w-full h-12 bg-primary text-primary-foreground rounded-2xl font-semibold text-base"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add New Category
          </Button>

          {isAddingCategory && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl p-3 card-shadow space-y-3 shrink-0"
            >
              <Input
                placeholder="Category Name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="h-12 rounded-xl text-lg"
              />

              <div>
                <Label className="text-sm font-semibold mb-2 block">Icon</Label>
                <div className="flex flex-wrap gap-2">
                  {emojiOptions.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setNewCategoryIcon(emoji)}
                      className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${
                        newCategoryIcon === emoji
                          ? 'bg-primary ring-2 ring-primary ring-offset-2'
                          : 'bg-muted'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-2 block">Color</Label>
                <div className="flex flex-wrap gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewCategoryColor(color)}
                      className={`w-12 h-12 rounded-xl bg-${color} transition-all ${
                        newCategoryColor === color
                          ? 'ring-2 ring-foreground ring-offset-2'
                          : ''
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleAddCategory}
                  className="flex-1 h-12 bg-secondary text-secondary-foreground rounded-xl font-semibold"
                >
                  <Check className="w-5 h-5 mr-2" />
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsAddingCategory(false)}
                  className="h-12 px-6 rounded-xl"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Category List */}
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-2 content-start overflow-y-auto pr-1">
            {categories.map((category) => {
              const isEditing = editingCategoryId === category.id;

              if (isEditing) {
                return (
                  <motion.div
                    key={category.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-card rounded-2xl p-4 card-shadow space-y-4"
                  >
                    <Input
                      placeholder="Category Name"
                      value={editCategoryName}
                      onChange={(e) => setEditCategoryName(e.target.value)}
                      className="h-12 rounded-xl text-lg"
                    />

                    <div>
                      <Label className="text-sm font-semibold mb-2 block">Icon</Label>
                      <div className="flex flex-wrap gap-2">
                        {emojiOptions.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => setEditCategoryIcon(emoji)}
                            className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${
                              editCategoryIcon === emoji
                                ? 'bg-primary ring-2 ring-primary ring-offset-2'
                                : 'bg-muted'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-semibold mb-2 block">Color</Label>
                      <div className="flex flex-wrap gap-2">
                        {colorOptions.map((color) => (
                          <button
                            key={color}
                            onClick={() => setEditCategoryColor(color)}
                            className={`w-12 h-12 rounded-xl bg-${color} transition-all ${
                              editCategoryColor === color
                                ? 'ring-2 ring-foreground ring-offset-2'
                                : ''
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveEditCategory}
                        className="flex-1 h-12 bg-secondary text-secondary-foreground rounded-xl font-semibold"
                      >
                        <Check className="w-5 h-5 mr-2" />
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleCancelEditCategory}
                        className="h-12 px-6 rounded-xl"
                      >
                        <X className="w-5 h-5" />
                      </Button>
                    </div>
                  </motion.div>
                );
              }

              return (
                <Card key={category.id} className="p-3 rounded-2xl flex items-center gap-3">
                  <div
                    className={`w-14 h-14 rounded-xl bg-${category.color} flex items-center justify-center text-2xl`}
                  >
                    {category.icon}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-lg">{category.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {getCardCountForCategory(category.id)} cards
                    </p>
                  </div>
                  <button
                    onClick={() => handleStartEditCategory(category)}
                    className="w-10 h-10 rounded-xl bg-sky/20 flex items-center justify-center"
                  >
                    <Edit3 className="w-5 h-5 text-sky" />
                  </button>
                  <button
                    onClick={() => onDeleteCategory(category.id)}
                    className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center"
                  >
                    <Trash2 className="w-5 h-5 text-destructive" />
                  </button>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="h-full flex flex-col gap-3 min-h-0">
          <Card className="p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-lg">Auto-Play Audio</p>
                <p className="text-sm text-muted-foreground">
                  Speak word when card appears
                </p>
              </div>
              <Switch
                checked={settings.autoPlayAudio}
                onCheckedChange={(checked) => onUpdateSettings({ autoPlayAudio: checked })}
              />
            </div>
          </Card>

          <Card className="p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-lg">Voice Speed</p>
                <p className="text-sm text-muted-foreground">
                  {settings.voiceSpeed === 'slow' ? 'Slower for learning' : 'Normal pace'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onUpdateSettings({ voiceSpeed: 'slow' })}
                  className={`px-4 py-2 rounded-xl font-semibold transition-all ${
                    settings.voiceSpeed === 'slow'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  Slow
                </button>
                <button
                  onClick={() => onUpdateSettings({ voiceSpeed: 'normal' })}
                  className={`px-4 py-2 rounded-xl font-semibold transition-all ${
                    settings.voiceSpeed === 'normal'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  Normal
                </button>
              </div>
            </div>
          </Card>

          <Card className="p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-lg">Repeat Audio</p>
                <p className="text-sm text-muted-foreground">
                  Repeat current card word every 3 seconds
                </p>
              </div>
              <Switch
                checked={settings.repeatAudio}
                onCheckedChange={(checked) => onUpdateSettings({ repeatAudio: checked })}
              />
            </div>
          </Card>

          <Card className="p-4 rounded-2xl">
            <div className="space-y-3">
              <div>
                <p className="font-bold text-lg">Backup & Restore</p>
                <p className="text-sm text-muted-foreground">
                  Save or restore all cards on this device
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleBackup}
                  disabled={isBackupBusy}
                  className="h-10 w-10 p-0 rounded-xl"
                  title="Backup to device"
                >
                  <Download className="w-4 h-4" />
                </Button>

                <input
                  type="file"
                  accept="application/json"
                  ref={restoreFileInputRef}
                  onChange={handleRestoreFileSelected}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => restoreFileInputRef.current?.click()}
                  disabled={isBackupBusy}
                  className="h-10 w-10 p-0 rounded-xl"
                  title="Restore from backup"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && (
        <div className="h-full flex items-center justify-center p-1">
          <Card className="w-full max-w-sm rounded-3xl border border-border/60 shadow-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-bold text-lg leading-tight">Account Access</p>
                <p className="text-xs text-muted-foreground">Secure sync for your flashcards</p>
              </div>
            </div>

            {currentUser ? (
              <div className="rounded-2xl border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Signed in</p>
                <p className="font-semibold text-sm truncate">{currentUser.email}</p>
              </div>
            ) : (
              <div className="rounded-2xl bg-muted p-1 grid grid-cols-2 gap-1">
                <button
                  onClick={() => setAuthMode('login')}
                  disabled={isAuthBusy}
                  className={`h-9 rounded-xl text-sm font-semibold transition-all ${
                    authMode === 'login'
                      ? 'bg-card shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Login
                </button>
                <button
                  onClick={() => setAuthMode('signup')}
                  disabled={isAuthBusy}
                  className={`h-9 rounded-xl text-sm font-semibold transition-all ${
                    authMode === 'signup'
                      ? 'bg-card shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign Up
                </button>
              </div>
            )}

            {!currentUser && (
              <div className="space-y-3">
                {authMode === 'signup' && (
                  <Input
                    placeholder="Full name"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    className="h-11 rounded-xl"
                    disabled={isAuthBusy}
                  />
                )}

                <Input
                  type="email"
                  placeholder="Email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={isAuthBusy}
                />

                <Input
                  type="password"
                  placeholder="Password"
                  value={accountPassword}
                  onChange={(e) => setAccountPassword(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={isAuthBusy}
                />

                {authMode === 'signup' && (
                  <Input
                    type="password"
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11 rounded-xl"
                    disabled={isAuthBusy}
                  />
                )}

                <Button
                  onClick={handleAccountSubmit}
                  className="w-full h-11 rounded-xl font-semibold"
                  disabled={isAuthBusy}
                >
                  {authMode === 'login' ? 'Login' : 'Create Account'}
                </Button>
              </div>
            )}

            {currentUser && (
              <Button variant="outline" onClick={handleLogout} className="w-full h-11 rounded-xl font-semibold" disabled={isAuthBusy}>
                Logout
              </Button>
            )}
          </Card>
        </div>
      )}

      </div>
    </div>
  );
}
