import { PostOnboardingAction, PostOnboardingActionId } from "@ledgerhq/types-live";
import { Icons } from "@ledgerhq/native-ui";
import { NavigatorName, ScreenName } from "~/const";

export const assetsTransferAction: PostOnboardingAction = {
  id: PostOnboardingActionId.assetsTransfer,
  disabled: false,
  featureFlagId: "postOnboardingAssetsTransfer",
  Icon: Icons.Lock,
  title: "postOnboarding.actions.assetsTransfer.title",
  titleCompleted: "postOnboarding.actions.assetsTransfer.titleCompleted",
  description: "postOnboarding.actions.assetsTransfer.description",
  actionCompletedPopupLabel: "postOnboarding.actions.assetsTransfer.popupLabel",
  buttonLabelForAnalyticsEvent: "Secure your assets on Ledger",
  getNavigationParams: () => [
    NavigatorName.ReceiveFunds,
    {
      screen: ScreenName.ReceiveSelectCrypto,
      params: {
        device: null,
      },
    },
  ],
};

export const buyCryptoAction: PostOnboardingAction = {
  id: PostOnboardingActionId.buyCrypto,
  disabled: false,
  Icon: Icons.Dollar,
  title: "postOnboarding.actions.buyCrypto.title",
  titleCompleted: "postOnboarding.actions.buyCrypto.titleCompleted",
  description: "postOnboarding.actions.buyCrypto.description",
  actionCompletedPopupLabel: "postOnboarding.actions.buyCrypto.popupLabel",
  buttonLabelForAnalyticsEvent: "Buy Crypto",
  getNavigationParams: () => [
    NavigatorName.Exchange,
    {
      screen: ScreenName.ExchangeBuy,
      params: {
        device: null,
      },
    },
  ],
};

export const customImageAction: PostOnboardingAction = {
  id: PostOnboardingActionId.customImage,
  Icon: Icons.PictureImage,
  title: "postOnboarding.actions.customImage.title",
  titleCompleted: "postOnboarding.actions.customImage.titleCompleted",
  description: "postOnboarding.actions.customImage.description",
  actionCompletedPopupLabel: "postOnboarding.actions.customImage.popupLabel",
  buttonLabelForAnalyticsEvent: "Set lock screen picture",
  getNavigationParams: ({ deviceModelId }) => [
    NavigatorName.CustomImage,
    {
      screen: ScreenName.CustomImageStep0Welcome,
      params: {
        device: null,
        deviceModelId,
      },
    },
  ],
};

export const recoverAction: PostOnboardingAction = {
  id: PostOnboardingActionId.recover,
  Icon: Icons.ShieldCheck,
  title: "postOnboarding.actions.recover.title",
  titleCompleted: "postOnboarding.actions.recover.titleCompleted",
  description: "postOnboarding.actions.recover.description",
  actionCompletedPopupLabel: "postOnboarding.actions.recover.popupLabel",
  buttonLabelForAnalyticsEvent: "Subscribe to Ledger Recover",
  getNavigationParams: () => [
    NavigatorName.Base,
    {
      screen: ScreenName.Recover,
      params: {
        platform: "protect-prod",
        redirectTo: "upsell",
      },
    },
  ],
};
