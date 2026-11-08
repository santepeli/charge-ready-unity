using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ChargeReady.EditorTools
{
    // Creates the config asset and the single scene, so the cloud build needs nothing made by hand.
    public static class BuildSetup
    {
        const string ConfigPath = "Assets/Resources/EconomyConfig.asset", ScenePath = "Assets/Scenes/Main.unity";

        [MenuItem("Charge Ready/Build Scene and Config")]
        public static void PreExport()
        {
            if (AssetDatabase.LoadAssetAtPath<EconomyConfig>(ConfigPath) == null)
            {
                if (!AssetDatabase.IsValidFolder("Assets/Resources")) AssetDatabase.CreateFolder("Assets", "Resources");
                AssetDatabase.CreateAsset(ScriptableObject.CreateInstance<EconomyConfig>(), ConfigPath);
            }
            if (!AssetDatabase.IsValidFolder("Assets/Scenes")) AssetDatabase.CreateFolder("Assets", "Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Game").AddComponent<Game>();
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.chargeready.prototype");
            AssetDatabase.SaveAssets();
        }
    }
}
