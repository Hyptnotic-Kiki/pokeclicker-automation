/**
 * @class The AutomationFarm regroups the 'Farming' functionalities
 *
 * @note The farm is not accessible right away when starting a new game.
 *       This menu will be hidden until the functionality is unlocked in-game.
 */
class AutomationFarm
{
    static Settings = {
                          FeatureEnabled: "Farming-Enabled",
                          FocusOnUnlocks: "Farming-FocusOnUnlocks",
                          OakItemLoadoutUpdate: "Farming-OakItemLoadoutUpdate"
                      };

    static ForcePlantBerriesAsked = false;

    /**
     * @brief Builds the menu, and initializes internal data
     *
     * @param initStep: The current automation init step
     */
    static initialize(initStep)
    {
        if (initStep == Automation.InitSteps.BuildMenu)
        {
            this.__internal__buildMenu();
        }
        else if (initStep == Automation.InitSteps.Finalize)
        {
            this.__internal__buildUnlockStrategySelection();
            this.__internal__chooseUnlockStrategy();

            // Restore previous session state
            this.toggleAutoFarming();
        }
    }

    /**
     * @brief Toggles the 'Farming' feature
     *
     * If the feature was enabled and it's toggled to disabled, the loop will be stopped.
     * If the feature was disabled and it's toggled to enabled, the loop will be started.
     *
     * @param enable: [Optional] If a boolean is passed, it will be used to set the right state.
     *                Otherwise, the local storage value will be used
     */
    static toggleAutoFarming(enable)
    {
        if (!App.game.farming.canAccess())
        {
            return;
        }

        // If we got the click event, use the button status
        if ((enable !== true) && (enable !== false))
        {
            enable = (Automation.Utils.LocalStorage.getValue(this.Settings.FeatureEnabled) === "true");
        }

        if (enable)
        {
            // Only set a loop if there is none active
            if (this.__internal__farmingLoop === null)
            {
                // Set auto-farm loop
                this.__internal__farmingLoop = setInterval(this.__internal__farmLoop.bind(this), 10000); // Runs every 10 seconds
            }
        }
        else
        {
            // Unregister the loop
            clearInterval(this.__internal__farmingLoop);
            this.__internal__farmingLoop = null;

            // Restore setting
            Automation.Utils.OakItem.ForbiddenItems = [];
        }
    }

    /*********************************************************************\
    |***    Internal members, should never be used by other classes    ***|
    \*********************************************************************/

    static __internal__farmingContainer = null;

    static __internal__farmingLoop = null;

    // Collection of
    // {
    //     isNeeded: function(),
    //     berryToUnlock: BerryType,
    //     harvestAsSoonAsPossible: boolean,
    //     oakItemToEquip: OakItemType,
    //     forbiddenOakItems: Array of OakItemType,
    //     requiredPokemon: String,
    //     requiresDiscord: boolean,
    //     action: function()
    // }
    static __internal__unlockStrategySelection = [];

    static __internal__harvestCount = 0;
    static __internal__freeSlotCount = 0;
    static __internal__plantedBerryCount = 0;

    static __internal__currentStrategy = null;

    /**
     * @brief Builds the menu
     */
    static __internal__buildMenu()
    {
        // Add the related buttons to the automation menu
        this.__internal__farmingContainer = document.createElement("div");
        Automation.Menu.AutomationButtonsDiv.appendChild(this.__internal__farmingContainer);

        Automation.Menu.addSeparator(this.__internal__farmingContainer);

        // Only display the menu when the farm is unlocked
        if (!App.game.farming.canAccess())
        {
            this.__internal__farmingContainer.hidden = true;
            this.__internal__setFarmingUnlockWatcher();
        }

        let autoFarmTooltip = "Automatically harvest and plant crops"
                            + Automation.Menu.TooltipSeparator
                            + "Crops are harvested as soon as they ripe\n"
                            + "New crops are planted using the selected one in the farm menu";
        let autoFarmingButton =
            Automation.Menu.addAutomationButton("Farming", this.Settings.FeatureEnabled, autoFarmTooltip, this.__internal__farmingContainer);
        autoFarmingButton.addEventListener("click", this.toggleAutoFarming.bind(this), false);

        // Build advanced settings panel
        let farmingSettingPanel = Automation.Menu.addSettingPanel(autoFarmingButton.parentElement.parentElement);

        let titleDiv = Automation.Menu.createTitleElement("Farming advanced settings");
        titleDiv.style.marginBottom = "10px";
        farmingSettingPanel.appendChild(titleDiv);

        let unlockTooltip = "Takes the necessary actions to unlock new slots and berries";
        Automation.Menu.addLabeledAdvancedSettingsToggleButton("Focus on unlocking plots and new berries",
                                                               this.Settings.FocusOnUnlocks,
                                                               unlockTooltip,
                                                               farmingSettingPanel);

        let disableOakItemTooltip = "Modifies the oak item loadout when required for a mutation to occur"
                                  + Automation.Menu.TooltipSeparator
                                  + "⚠️ Disabling this functionality will prevent some berries from being unlocked";
        Automation.Menu.addLabeledAdvancedSettingsToggleButton("Update oak item loadout when needed",
                                                               this.Settings.OakItemLoadoutUpdate,
                                                               disableOakItemTooltip,
                                                               farmingSettingPanel);
    }

    /**
     * @brief Watches for the in-game functionality to be unlocked.
     *        Once unlocked, the menu will be displayed to the user
     */
    static __internal__setFarmingUnlockWatcher()
    {
        let watcher = setInterval(function()
        {
            if (App.game.farming.canAccess())
            {
                clearInterval(watcher);
                this.__internal__farmingContainer.hidden = false;
                this.toggleAutoFarming();
            }
        }.bind(this), 10000); // Check every 10 seconds
    }

    /**
     * @brief The Farming loop
     *
     * Automatically harvests crops and plants the selected berry (from the in-game menu)
     */
    static __internal__farmLoop()
    {
        this.__internal__harvestAsEfficientAsPossible();
        this.__internal__tryToUnlockNewSpots();

        if (Automation.Utils.LocalStorage.getValue(this.Settings.FocusOnUnlocks) === "true")
        {
            this.__internal__chooseUnlockStrategy();
        }

        if ((Automation.Utils.LocalStorage.getValue(this.Settings.FocusOnUnlocks) === "true")
            && !this.ForcePlantBerriesAsked)
        {
            this.__internal__removeOakItemIfNeeded();
            this.__internal__equipOakItemIfNeeded();
            this.__internal__currentStrategy.action();
        }
        else
        {
            this.__internal__plantAllBerries();
        }
    }

    static __internal__equipOakItemIfNeeded()
    {
        if ((this.__internal__currentStrategy.oakItemToEquip === null)
            || (Automation.Utils.LocalStorage.getValue(this.Settings.OakItemLoadoutUpdate) !== "true"))
        {
            return;
        }

        // Equip the right oak item if not already equipped
        let currentLoadout = App.game.oakItems.itemList.filter((item) => item.isActive);

        if (!currentLoadout.some(item => (item.name == this.__internal__currentStrategy.oakItemToEquip)))
        {
            // Remove the last item of the current loadout if needed
            if (currentLoadout.length === App.game.oakItems.maxActiveCount())
            {
                App.game.oakItems.deactivate(currentLoadout.reverse()[0].name);
            }

            // Equip the needed item
            App.game.oakItems.activate(this.__internal__currentStrategy.oakItemToEquip);
        }
    }

    static __internal__removeOakItemIfNeeded()
    {
        if (Automation.Utils.LocalStorage.getValue(this.Settings.OakItemLoadoutUpdate) !== "true")
        {
            return;
        }

        Automation.Utils.OakItem.ForbiddenItems = this.__internal__currentStrategy.forbiddenOakItems;

        for (const item of this.__internal__currentStrategy.forbiddenOakItems)
        {
            App.game.oakItems.deactivate(item);
        }
    }

    /**
     * @brief Unlock any locked spot if the player has the required resources
     */
    static __internal__tryToUnlockNewSpots()
    {
        for (const [ index, plot ] of App.game.farming.plotList.entries())
        {
            if (!plot.isUnlocked)
            {
                FarmController.plotClick(index, { shiftKey: false });
            }
        }
    }

    /**
     * @brief Chooses the best harvesting time depending on the desired action.
     *
     * While trying to get mutations or to attract wandering pokemons, the best move is to harvest the crop right before they die
     * Otherwise, the crop is harvested as soon as it ripes
     */
    static __internal__harvestAsEfficientAsPossible()
    {
        this.__internal__harvestCount = 0;
        this.__internal__freeSlotCount = 0;
        this.__internal__plantedBerryCount = 0;

        // Mutations can only occur while the berry is fully ripe, so we need to collect them the later possible
        for (const [ index, plot ] of App.game.farming.plotList.entries())
        {
            if (plot.isEmpty())
            {
                if (plot.isUnlocked)
                {
                    this.__internal__freeSlotCount++;
                }
                continue;
            }

            if (plot.stage() != PlotStage.Berry)
            {
                continue;
            }

            // Harvest berry in any of those cases:
            //   - The unlock feature is disabled
            //   - Another feature required force harvesting
            //   - The strategy requires to harvest as soon as possible
            //   - The berry is the target one
            //   - The berry is close to dying (less than 15s)
            if ((Automation.Utils.LocalStorage.getValue(this.Settings.FocusOnUnlocks) === "false")
                || this.ForcePlantBerriesAsked
                || (this.__internal__currentStrategy === null)
                || (this.__internal__currentStrategy.harvestAsSoonAsPossible === true)
                || ((this.__internal__currentStrategy.berryToUnlock !== undefined)
                    && (this.__internal__currentStrategy.berryToUnlock == plot.berry))
                || ((plot.berryData.growthTime[PlotStage.Berry] - plot.age) < 15))
            {
                App.game.farming.harvest(index);
                this.__internal__harvestCount++;
                this.__internal__freeSlotCount++;
            }
        }
    }

    /**
     * @brief If any spot is available, plants the selected berry (from the in-game menu)
     */
    static __internal__plantAllBerries()
    {
        if (this.__internal__freeSlotCount > 0)
        {
            let selectedBerryType = FarmController.selectedBerry();
            let selectedBerryCount = App.game.farming.berryList[selectedBerryType]();

            if (selectedBerryCount > 0)
            {
                App.game.farming.plantAll(selectedBerryType);

                this.__internal__plantedBerryCount = Math.min(this.__internal__freeSlotCount, selectedBerryCount);

                let berryName = BerryType[selectedBerryType];
                let berryImage = '<img src="assets/images/items/berry/' + berryName + '.png" height="28px">';
                this.__internal__sendNotif("Planted some " + berryName + " " + berryImage);
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for mutation requiring over 600 points, with a single berry type
     *
     * @param berryType: The type of berry to plant
     */
    static __internal__plantABerryForMutationRequiringOver600Points(berryType)
    {
        // This represents the following strategy
        //  |o|o|o|o|o|
        //  |o| |o| |o|
        //  |o| | | |o|
        //  |o|o|o|o|o|
        //  |o|o|o|o|o|
        for (const index of App.game.farming.plotList.keys())
        {
            if (![ 6, 8, 11, 12, 13 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berryType);
            }
            else
            {
                this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for mutation requiring 23 berries on the field, with a single berry type
     *
     * @param berryType: The type of berry to plant
     */
    static __internal__plantABerryForMutationRequiring23Berries(berryType)
    {
        // This represents the following strategy
        //  |o|o|o|o|o|
        //  |o|o|o|o|o|
        //  |o|o| | |o|
        //  |o|o|o|o|o|
        //  |o|o|o|o|o|
        for (const index of App.game.farming.plotList.keys())
        {
            if (![ 12, 13 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berryType);
            }
            else
            {
                this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for mutation, with two different berry types
     *
     * @param berry1Type: The first berry type
     * @param berry2Type: The second berry type
     */
    static __internal__plantTwoBerriesForMutation(berry1Type, berry2Type)
    {
        if (App.game.farming.plotList.every((plot) => plot.isUnlocked))
        {
            // This represents the following strategy
            //  |1| | |1| |
            //  | |2| | |2|
            //  | | | | | |
            //  |1| | |1| |
            //  | |2| | |2|
            for (const index of App.game.farming.plotList.keys())
            {
                if ([ 0, 3, 15, 18 ].includes(index))
                {
                    this.__internal__tryPlantBerryAtIndex(index, berry1Type);
                }
                else if ([ 6, 9, 21, 24 ].includes(index))
                {
                    this.__internal__tryPlantBerryAtIndex(index, berry2Type);
                }
                else
                {
                    this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                }
            }
        }
        else if (App.game.farming.plotList[2].isUnlocked)
        {
            if (App.game.farming.plotList[10].isUnlocked
                && App.game.farming.plotList[14].isUnlocked
                && App.game.farming.plotList[22].isUnlocked)
            {
                // This represents the following strategy
                //  |x|x|1|x|x|
                //  |x| | | |x|
                //  |1| |2| |1|
                //  |x| | | |x|
                //  |x|x|1|x|x|
                for (const index of App.game.farming.plotList.keys())
                {
                    if (index == 12)
                    {
                        this.__internal__tryPlantBerryAtIndex(index, berry2Type);
                    }
                    else if ([ 2, 10, 14, 22 ].includes(index))
                    {
                        this.__internal__tryPlantBerryAtIndex(index, berry1Type);
                    }
                    else
                    {
                        this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            }
            else
            {
                // This represents the following strategy
                //  |x|x|1|x|x|
                //  |x| | | |x|
                //  |x| |2| |x|
                //  |x| |1| |x|
                //  |x|x|x|x|x|
                for (const index of App.game.farming.plotList.keys())
                {
                    if (index == 12)
                    {
                        this.__internal__tryPlantBerryAtIndex(index, berry2Type);
                    }
                    else if ([ 2, 17 ].includes(index))
                    {
                        this.__internal__tryPlantBerryAtIndex(index, berry1Type);
                    }
                    else
                    {
                        this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            }
        }
        else
        {
            // This represents the following strategy
            //  |x|x|x|x|x|
            //  |x| |1| |x|
            //  |x|2| |2|x|
            //  |x| |1| |x|
            //  |x|x|x|x|x|
        for (const index of App.game.farming.plotList.keys())
            {
                if ([ 7, 17 ].includes(index))
                {
                    this.__internal__tryPlantBerryAtIndex(index, berry1Type);
                }
                else if ([ 11, 13 ].includes(index))
                {
                    this.__internal__tryPlantBerryAtIndex(index, berry2Type);
                }
                else
                {
                    this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                }
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for mutation, with three different berry types
     *
     * @param berry1Type: The first berry type
     * @param berry2Type: The second berry type
     * @param berry3Type: The third berry type
     */
    static __internal__plantThreeBerriesForMutation(berry1Type, berry2Type, berry3Type)
    {
        // This represents the following strategy
        //  | |1| | |1|
        //  |2|3| |2|3|
        //  | | | | | |
        //  | |1| | |1|
        //  |2|3| |2|3|
        for (const index of App.game.farming.plotList.keys())
        {
            if ([ 1, 4, 16, 19 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry1Type);
            }
            else if ([ 5, 8, 20, 23 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry2Type);
            }
            else if ([ 6, 9, 21, 24 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry3Type);
            }
            else
            {
                this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for mutation, with four different berry types
     *
     * @param berry1Type: The first berry type
     * @param berry2Type: The second berry type
     * @param berry3Type: The third berry type
     * @param berry4Type: The fourth berry type
     */
    static __internal__plantFourBerriesForMutation(berry1Type, berry2Type, berry3Type, berry4Type)
    {
        // This represents the following strategy
        //  |1| |2| |1|
        //  |3| |4| |3|
        //  | | | | | |
        //  |2| |1| |2|
        //  |4| |3| |4|
        for (const index of App.game.farming.plotList.keys())
        {
            if ([ 0, 4, 17 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry1Type);
            }
            else if ([ 2, 15, 19 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry2Type);
            }
            else if ([ 5, 9, 22 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry3Type);
            }
            else if ([ 7, 20, 24 ].includes(index))
            {
                this.__internal__tryPlantBerryAtIndex(index, berry4Type);
            }
            else
            {
                this.__internal__tryPlantBerryAtIndex(index, BerryType.None);
            }
        }
    }

    /**
     * @brief Selects the optimum berry placement for surrounding berry mutation, with two different berry types
     *
     * @param triggerBerryType: The berry type that triggers the mutation
     * @param mutatedBerryType: The berry type of the mutated berry
     */
    static __internal__plantTwoBerriesForSurroundingMutation(triggerBerryType, mutatedBerryType)
    {
        // This represents the following strategy (triggerBerryType = x, mutatedBerryType = o)
        //  |o|o|o|o|o|
        //  |o|x|o|o|x|
        //  |o|o|o|o|o|
        //  |o|o|o|o|o|
        //  |o|x|o|o|x|
        for (const index of App.game.farming.plotList.keys())
        {
            let berryType = [ 6, 9, 21, 24 ].includes(index) ? triggerBerryType : mutatedBerryType;
            this.__internal__tryPlantBerryAtIndex(index, berryType);
        }
    }

    /**
     * @brief Tries to plant the given @p berryType in the selected @p index
     *
     * A berry can only be planted if:
     *    - The selected spot is unlocked
     *    - The spot is empty
     *    - The player has a berry to plant in its inventory
     *
     * @param index: The index of the spot to plant the berry in
     * @param berryType: The type of the berry to plant
     *                   (passing BerryType.None will remove any present berry, but plant none)
     */
    static __internal__tryPlantBerryAtIndex(index, berryType)
    {
        let plot = App.game.farming.plotList[index];

        if (!plot.isUnlocked)
        {
            return;
        }

        // Remove any mutation that might have occured, as soon as possible
        if (!plot.isEmpty())
        {
            // TODO (02/08/2022): We should add an option to use shovels in such case
            if ((plot.berry !== berryType) && (plot.stage() == PlotStage.Berry))
            {
                this.__internal__harvestCount++;
                App.game.farming.harvest(index);
            }
            else
            {
                return;
            }
        }

        if (berryType === BerryType.None)
        {
            return;
        }

        if (App.game.farming.hasBerry(berryType))
        {
            App.game.farming.plant(index, berryType, true);
            this.__internal__plantedBerryCount++;
        }
    }

    /**
     * @brief Tries to plant the given @p berryType in the selected @p indexes
     *
     * @see __internal__tryPlantBerryAtIndex
     *
     * @param indexes: The list of indexes of the spot to plant the berry in
     * @param berryType: The type of the berry to plant
     */
    static __internal__tryPlantBerryAtIndexes(berryType, indexes)
    {
        for (const index of indexes)
        {
            this.__internal__tryPlantBerryAtIndex(index, berryType);
        }
    }

    /**
     * @brief Builds the internal berry/slot unlock strategy selection list
     */
    static __internal__buildUnlockStrategySelection()
    {
        this.__internal__addGen1UnlockStrategies();
        this.__internal__addGen2UnlockStrategies();
        this.__internal__addGen3UnlockStrategies();
        this.__internal__addGen4UnlockStrategies();
        this.__internal__addGen5UnlockStrategies();

        this.__internal__addUnneededBerriesStrategies();
        this.__internal__addEnigmaBerryStrategy();
    }

    /**
     * @brief Adds first generation berries unlock strategies to the internal list
     */
    static __internal__addGen1UnlockStrategies()
    {
        /*********************************\
        |*     Gen 1 berries unlocks     *|
        \*********************************/

        // #1 Unlock the slot requiring Cheri
        this.__internal__addUnlockSlotStrategy(7, BerryType.Cheri);

        // #2 Unlock the slot requiring Chesto
        this.__internal__addUnlockSlotStrategy(13, BerryType.Chesto);

        // #3 Unlock the slot requiring Pecha
        this.__internal__addUnlockSlotStrategy(17, BerryType.Pecha);

        // #4 Unlock the slot requiring Rawst
        this.__internal__addUnlockSlotStrategy(11, BerryType.Rawst);

        // #5 Unlock the slot requiring Aspear
        this.__internal__addUnlockSlotStrategy(6, BerryType.Aspear);

        // #6 Unlock the slot requiring Leppa
        this.__internal__addUnlockSlotStrategy(8, BerryType.Leppa);

        // #7 Unlock the slot requiring Oran
        this.__internal__addUnlockSlotStrategy(18, BerryType.Oran);

        // #8 Unlock the slot requiring Sitrus
        this.__internal__addUnlockSlotStrategy(16, BerryType.Sitrus);

        /**********************************\
        |*   Harvest some Gen 1 berries   *|
        \**********************************/

        // Make sure to have at least 20 of each berry type before proceeding
        this.__internal__addBerryRequirementBeforeFurtherUnlockStrategy(
            20,
            [
                BerryType.Cheri, BerryType.Chesto, BerryType.Pecha, BerryType.Rawst,
                BerryType.Aspear, BerryType.Leppa, BerryType.Oran, BerryType.Sitrus
            ]);
    }

    /**
     * @brief Adds second generation berries unlock strategies to the internal list
     */
    static __internal__addGen2UnlockStrategies()
    {
        /*********************************\
        |*     Gen 2 berries unlocks     *|
        \*********************************/

        // #9 Unlock at least one Persim berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Persim, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Oran, BerryType.Pecha); });

        // Unlock the slot requiring Persim
        this.__internal__addUnlockSlotStrategy(2, BerryType.Persim);

        // #10 Unlock at least one Razz berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Razz, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Leppa, BerryType.Cheri); });

        // Unlock the slot requiring Razz
        this.__internal__addUnlockSlotStrategy(14, BerryType.Razz);

        // #11 Unlock at least one Bluk berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Bluk, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Leppa, BerryType.Chesto); });

        // Unlock the slot requiring Bluk
        this.__internal__addUnlockSlotStrategy(22, BerryType.Bluk);

        // #12 Unlock at least one Nanab berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Nanab, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Aspear, BerryType.Pecha); });

        // Unlock the slot requiring Nanab
        this.__internal__addUnlockSlotStrategy(10, BerryType.Nanab);

        // #13 Unlock at least one Wepear berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Wepear, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Oran, BerryType.Rawst); });

        // Unlock the slot requiring Wepear
        this.__internal__addUnlockSlotStrategy(3, BerryType.Wepear);

        // #14 Unlock at least one Pinap berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Pinap, function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Sitrus, BerryType.Aspear); });

        // Unlock the slot requiring Pinap
        this.__internal__addUnlockSlotStrategy(19, BerryType.Pinap);

        // #15 Unlock at least one Figy berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Figy,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 2, 3, 6, 10, 14, 16, 18, 19, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Cheri);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Figy
        this.__internal__addUnlockSlotStrategy(21, BerryType.Figy);

        // #16 Unlock at least one Wiki berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Wiki,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 2, 3, 6, 10, 12, 14, 19, 21, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Chesto);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Wiki
        this.__internal__addUnlockSlotStrategy(5, BerryType.Wiki);

        // #17 Unlock at least one Mago berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Mago,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 2, 3, 5, 10, 12, 14, 19, 21, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Pecha);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Mago
        this.__internal__addUnlockSlotStrategy(1, BerryType.Mago);

        // #18 Unlock at least one Aguav berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Aguav,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 2, 3, 5, 10, 12, 14, 19, 21, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Rawst);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Aguav
        this.__internal__addUnlockSlotStrategy(9, BerryType.Aguav);

        // #19 Unlock at least one Iapapa berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Iapapa,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 2, 3, 5, 10, 12, 14, 19, 21, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Aspear);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Iapapa
        this.__internal__addUnlockSlotStrategy(23, BerryType.Iapapa);

        /**********************************\
        |*   Harvest some Gen 2 berries   *|
        \**********************************/

        // Make sure to have at least 20 of each berry type before proceeding
        this.__internal__addBerryRequirementBeforeFurtherUnlockStrategy(
            20,
            [
                BerryType.Persim, BerryType.Razz, BerryType.Bluk, BerryType.Nanab, BerryType.Wepear, BerryType.Pinap,
                BerryType.Figy, BerryType.Wiki, BerryType.Mago, BerryType.Aguav, BerryType.Iapapa
            ]);
    }

    /**
     * @brief Adds third generation berries unlock strategies to the internal list
     */
    static __internal__addGen3UnlockStrategies()
    {
        /*********************************\
        |*     Gen 3 berries unlocks     *|
        \*********************************/

        // #21 Unlock at least one Pomeg berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Pomeg,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 5, 8, 16, 19 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Iapapa);
                    }
                    else if ([ 6, 9, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Mago);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Pomeg
        this.__internal__addUnlockSlotStrategy(15, BerryType.Pomeg);

        // #22 Unlock at least one Kelpsy berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Kelpsy,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 6, 8, 21, 23 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Persim);
                    }
                    else if ([ 7, 10, 14, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Chesto);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Kelpsy
        this.__internal__addUnlockSlotStrategy(0, BerryType.Kelpsy);

        // #23 Unlock at least one Qualot berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Qualot,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 0, 8, 15, 18 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Pinap);
                    }
                    else if ([ 6, 9, 19, 21 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Mago);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Qualot
        this.__internal__addUnlockSlotStrategy(4, BerryType.Qualot);

        // #24 Unlock at least one Hondew berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Hondew,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 1, 8, 15, 23 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Figy);
                    }
                    else if ([ 3, 5, 17, 19 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Wiki);
                    }
                    else if ([ 6, 9, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Aguav);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Hondew
        this.__internal__addUnlockSlotStrategy(24, BerryType.Hondew);

        // #25 Unlock at least one Grepa berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Grepa,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 0, 3, 15, 18 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Aguav);
                    }
                    else if ([ 6, 9, 21, 24 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Figy);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Unlock the slot requiring Grepa
        this.__internal__addUnlockSlotStrategy(20, BerryType.Grepa);

        /////
        ///// From here, all spots are available
        /////

        // #26 Unlock at least one Tamato berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Tamato,
            function() { Automation.Farm.__internal__plantTwoBerriesForSurroundingMutation(BerryType.Pomeg, BerryType.Razz); });

        // #27 Unlock at least one Cornn berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Cornn,
            function() { Automation.Farm.__internal__plantThreeBerriesForMutation(BerryType.Leppa, BerryType.Bluk, BerryType.Wiki); });

        // #28 Unlock at least one Magost berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Magost,
            function() { Automation.Farm.__internal__plantThreeBerriesForMutation(BerryType.Pecha, BerryType.Nanab, BerryType.Mago); });

        // #29 Unlock at least one Rabuta berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Rabuta,
            function()
            {
                Automation.Farm.__internal__plantTwoBerriesForSurroundingMutation(BerryType.Aguav, BerryType.Aspear);
            });

        // #30 Unlock at least one Nomel berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Nomel,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 6, 9, 21, 24 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Pinap);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // Make sure to have at least 25 of each berry type before proceeding
        this.__internal__addBerryRequirementBeforeFurtherUnlockStrategy(
            25,
            [
                BerryType.Tamato, BerryType.Cornn, BerryType.Magost, BerryType.Rabuta, BerryType.Nomel
            ]);

        // #31 Unlock at least one Spelon berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Spelon,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Tamato);
                }
            });

        // #32 Unlock at least one Pamtre berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Pamtre,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Cornn);
                }
            },
            1,
            null,
            [ OakItemType.Cell_Battery ]);

        // #33 Unlock at least one Watmel berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Watmel,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Magost);
                }
            });

        // #34 Unlock at least one Durin berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Durin,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Rabuta);
                }
            });

        // #35 Unlock at least one Belue berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Belue,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Nomel);
                }
            });

        /**********************************\
        |*   Harvest some Gen 3 berries   *|
        \**********************************/

        // Make sure to have at least 25 of each berry type before proceeding
        this.__internal__addBerryRequirementBeforeFurtherUnlockStrategy(
            25,
            [
                BerryType.Pomeg, BerryType.Kelpsy, BerryType.Qualot, BerryType.Hondew, BerryType.Grepa,
                BerryType.Spelon, BerryType.Pamtre, BerryType.Watmel, BerryType.Durin, BerryType.Belue
            ]);
    }

    /**
     * @brief Adds fourth generation berries unlock strategies to the internal list
     */
    static __internal__addGen4UnlockStrategies()
    {
        /*********************************\
        |*     Gen 4 berries unlocks     *|
        \*********************************/

        // #36 Unlock at least one Occa berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Occa,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Tamato, BerryType.Figy, BerryType.Spelon, BerryType.Razz);
            },
            1,
            null,
            [ OakItemType.Blaze_Cassette ]);

        // #44 Unlock at least one Coba berry through mutation (even though it's a berry further in the list, it's needed for the next berry's unlock)
        this.__internal__addUnlockMutationStrategy(
            BerryType.Coba,
            function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Wiki, BerryType.Aguav); });

        // #37 Unlock at least one Passho berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Passho,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Oran, BerryType.Kelpsy, BerryType.Chesto, BerryType.Coba);
            });

        // #38 Unlock at least one Wacan berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Wacan,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Iapapa, BerryType.Pinap, BerryType.Qualot, BerryType.Grepa);
            });

        // #39 Unlock at least one Rindo berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Rindo,
            function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Figy, BerryType.Aguav); });

        // #40 Unlock at least one Yache berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Yache,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 0, 2, 4, 10, 12, 14, 20, 22, 24 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Passho);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // #45 Unlock at least one Payapa berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Payapa,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Wiki, BerryType.Cornn, BerryType.Bluk, BerryType.Pamtre);
            },
            1,
            null,
            [ OakItemType.Rocky_Helmet, OakItemType.Cell_Battery ]);

        // #46 Unlock at least one Tanga berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Tanga,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if (![ 6, 8, 16, 18 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Rindo);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // #48 Unlock at least one Kasib berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Kasib,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Cheri);
                }
            },
            4);

        // #49 Unlock at least one Haban berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Haban,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Occa, BerryType.Passho, BerryType.Wacan, BerryType.Rindo);
            });

        // #50 Unlock at least one Colbur berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Colbur,
            function() { Automation.Farm.__internal__plantThreeBerriesForMutation(BerryType.Rabuta, BerryType.Kasib, BerryType.Payapa); });

        // #53 Unlock at least one Roseli berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Roseli,
            function()
            {
                Automation.Farm.__internal__plantFourBerriesForMutation(BerryType.Mago, BerryType.Magost, BerryType.Nanab, BerryType.Watmel);
            },
            1,
            null,
            [ OakItemType.Sprinklotad ]);

        /////
        // Perform mutations requiring Oak items last to avoid any problem du to the player not having unlocked those

        // #43 Unlock at least one Shuca berry through mutation (moved this far to avoid any problem, since it uses Oak items)
        this.__internal__addUnlockMutationStrategy(
            BerryType.Shuca,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Watmel);
                }
            },
            1,
            OakItemType.Sprinklotad);

        // #47 Unlock at least one Charti berry through mutation (moved this far to avoid any problem, since it uses Oak items)
        this.__internal__addUnlockMutationStrategy(
            BerryType.Charti,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Cornn);
                }
            },
            1,
            OakItemType.Cell_Battery);

        // #51 Unlock at least one Babiri berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Babiri,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 0, 1, 2, 3, 4, 7, 17, 20, 21, 22, 23, 24 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Shuca);
                    }
                    else if ([ 5, 9, 10, 11, 12, 13, 14, 15, 19 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Charti);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            });

        // #41 Unlock at least one Chople berry through mutation (moved this far to avoid any problem, since it uses Oak items)
        this.__internal__addUnlockMutationStrategy(
            BerryType.Chople,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Spelon);
                }
            },
            1,
            OakItemType.Blaze_Cassette);

        // The next mutation need to grow berries while others are ripe, so we need to start on a empty farm
        this.__internal__unlockStrategySelection.push(
            {
                isNeeded: function()
                    {
                        return !App.game.farming.unlockedBerries[BerryType.Chilan]()
                            && !App.game.farming.plotList.every(
                                   (plot) =>
                                   {
                                        return plot.isEmpty() || (plot.berry === BerryType.Chople);
                                   });
                    },
                harvestAsSoonAsPossible: true,
                oakItemToEquip: null,
                forbiddenOakItems: [],
                requiredPokemon: null,
                requiresDiscord: false,
                action: function() {}
            });

        // #52 Unlock at least one Chilan berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Chilan,
            function()
            {
                // Nothing planted, plant the first batch
                if (App.game.farming.plotList[6].isEmpty())
                {
                    for (const index of [ 6, 8, 16, 18 ])
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Chople);
                    }
                }
                // First batch ripped, plant the rest
                else if (App.game.farming.plotList[6].age > App.game.farming.plotList[6].berryData.growthTime[PlotStage.Bloom])
                {
                    for (const index of App.game.farming.plotList.keys())
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Chople);
                    }
                }
            });

        // #42 Unlock at least one Kebia berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Kebia,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Pamtre);
                }
            },
            1,
            OakItemType.Rocky_Helmet);
    }

    /**
     * @brief Adds fifth generation berries unlock strategies to the internal list
     */
    static __internal__addGen5UnlockStrategies()
    {
        /*********************************\
        |*     Gen 5 berries unlocks     *|
        \*********************************/

        // #54 Unlock at least one Micle berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Micle,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiringOver600Points(BerryType.Pamtre); },
            1,
            null,
            [ OakItemType.Rocky_Helmet ]);

        // #55 Unlock at least one Custap berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Custap,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiringOver600Points(BerryType.Watmel); },
            1,
            null,
            [ OakItemType.Sprinklotad ]);

        // #56 Unlock at least one Jaboca berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Jaboca, function() { Automation.Farm.__internal__plantABerryForMutationRequiringOver600Points(BerryType.Durin); });

        // #57 Unlock at least one Rowap berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Rowap, function() { Automation.Farm.__internal__plantABerryForMutationRequiringOver600Points(BerryType.Belue); });

        //////
        // The following mutations require the player to have caught legendary pokemons

        // #60 Unlock at least one Liechi berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Liechi,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiring23Berries(BerryType.Passho); },
            4,
            null,
            [],
            "Kyogre");

        // #61 Unlock at least one Ganlon berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Ganlon,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiring23Berries(BerryType.Shuca); },
            4,
            null,
            [],
            "Groudon");

        // #58 Unlock at least one Kee berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Kee,
            function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Liechi, BerryType.Ganlon); });

        // #62 Unlock at least one Salac berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Salac,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiring23Berries(BerryType.Coba); },
            4,
            null,
            [],
            "Rayquaza");

        // #63 Unlock at least one Petaya berry through mutation
        this.__internal__addUnlockMutationStrategy(BerryType.Petaya,
                                                   function()
                                                   {
                                                       // Plant the needed berries
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(0, BerryType.Kasib);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(2, BerryType.Payapa);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(4, BerryType.Yache);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(5, BerryType.Shuca);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(9, BerryType.Wacan);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(10, BerryType.Chople);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(11, BerryType.Coba);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(12, BerryType.Kebia);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(14, BerryType.Haban);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(15, BerryType.Colbur);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(16, BerryType.Babiri);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(17, BerryType.Charti);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(19, BerryType.Tanga);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(20, BerryType.Occa);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(21, BerryType.Rindo);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(22, BerryType.Passho);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(23, BerryType.Roseli);
                                                       Automation.Farm.__internal__tryPlantBerryAtIndex(24, BerryType.Chilan);

                                                       for (const index of [ 1, 3, 6, 7, 8, 13, 18 ])
                                                       {
                                                           Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                                                       }
                                                   },
                                                   4);

        // #59 Unlock at least one Maranga berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Maranga,
            function() { Automation.Farm.__internal__plantTwoBerriesForMutation(BerryType.Salac, BerryType.Petaya); });

        // #64 Unlock at least one Apicot berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Apicot,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiring23Berries(BerryType.Chilan); },
            1,
            null,
            [],
            "Palkia");

        // #65 Unlock at least one Lansat berry through mutation
        this.__internal__addUnlockMutationStrategy(
            BerryType.Lansat,
            function() { Automation.Farm.__internal__plantABerryForMutationRequiring23Berries(BerryType.Roseli); },
            1,
            null,
            [],
            "Dialga");

        // #66 Unlock at least one Starf berry through mutation
        this.__internal__addUnlockMutationStrategy(BerryType.Starf,
                                                   function()
                                                   {
                                                       for (const index of App.game.farming.plotList.keys())
                                                       {
                                                           if (![ 11, 12, 13 ].includes(index))
                                                           {
                                                               Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Roseli);
                                                           }
                                                           else
                                                           {
                                                               Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                                                           }
                                                       }
                                                   });
    }

    /**
     * @brief Some berries are not needed to unlock other berries and can be pretty anoying to mutate.
     *        This method add such berry farming strategy
     */
    static __internal__addUnneededBerriesStrategies()
    {
        /*************\
        |*   Gen 2   *|
        \*************/

        // #20 Unlock and gather at least 24 Lum berry through mutation
        this.__internal__addUnlockMutationStrategy(BerryType.Lum,
            function()
            {
                for (const index of App.game.farming.plotList.keys())
                {
                    if ([ 0, 4, 20, 24 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Sitrus);
                    }
                    else if ([ 1, 3, 21, 23 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Oran);
                    }
                    else if ([ 2, 22 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Aspear);
                    }
                    else if ([ 5, 9, 15, 19 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Leppa);
                    }
                    else if ([ 7, 17 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Pecha);
                    }
                    else if ([ 10, 14 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Rawst);
                    }
                    else if ([ 11, 13 ].includes(index))
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Chesto);
                    }
                    else if (index == 12)
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.Cheri);
                    }
                    else
                    {
                        Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                    }
                }
            },
            24);
    }

    /**
     * @brief Adds Enigma berry (requiring a discord account linked) unlock strategy to the internal list
     */
    static __internal__addEnigmaBerryStrategy()
    {
        this.__internal__unlockStrategySelection.push(
            {
                // Check if the berry is unlocked
                isNeeded: function() { return !App.game.farming.unlockedBerries[BerryType.Enigma](); },
                berryToUnlock: BerryType.Enigma,
                harvestAsSoonAsPossible: false,
                oakItemToEquip: null,
                forbiddenOakItems: [],
                requiredPokemon: null,
                requiresDiscord: true,
                action: function()
                        {
                            let neededBerries = EnigmaMutation.getReqs();

                            for (const index of App.game.farming.plotList.keys())
                            {
                                if ([ 1, 13 ].includes(index))
                                {
                                    // North berry
                                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, neededBerries[0]);
                                }
                                else if ([ 5, 17 ].includes(index))
                                {
                                    // West berry
                                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, neededBerries[1]);
                                }
                                else if ([ 7, 19 ].includes(index))
                                {
                                    // East berry
                                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, neededBerries[2]);
                                }
                                else if ([ 11, 23 ].includes(index))
                                {
                                    // South berry
                                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, neededBerries[3]);
                                }
                                else
                                {
                                    Automation.Farm.__internal__tryPlantBerryAtIndex(index, BerryType.None);
                                }
                            }
                        }
            });
    }

    /**
     * @brief Adds an unlock strategy to unlock the slot at @p slotIndex that requires @p berryType
     *
     * @param slotIndex: The index of the slot to unlock
     * @param berryType: The type of berry needed to unlock this slot
     */
    static __internal__addUnlockSlotStrategy(slotIndex, berryType)
    {
        this.__internal__unlockStrategySelection.push(
            {
                // Check if the slot is unlocked
                isNeeded: function() { return !App.game.farming.plotList[slotIndex].isUnlocked; },
                harvestAsSoonAsPossible: true,
                oakItemToEquip: null,
                forbiddenOakItems: [],
                requiredPokemon: null,
                requiresDiscord: false,
                // If not unlocked, then farm some needed berries
                action: function()
                {
                    if (App.game.farming.plotBerryCost(slotIndex).amount > App.game.farming.berryList[berryType]())
                    {
                        FarmController.selectedBerry(berryType);
                    }
                    else
                    {
                        // Not enough farm point, lets plant some Cheri berries to get some fast
                        FarmController.selectedBerry(BerryType.Cheri);
                    }
                    Automation.Farm.__internal__plantAllBerries();
                }
            });
    }

    /**
     * @brief Adds an unlock strategy to unlock a berry using mutations
     *
     * @param berryType: The type of berry to unlock
     * @param actionCallback: The action to perform if it's locked
     * @param minimumRequiredBerry: The minimum of berries to hold required (Default: 1)
     * @param oakItemNeeded: The Oak item needed for the mutation to work (Default: None)
     * @param oakItemsToRemove: The Oak items list that might ruin the mutation and needs to be forbidden (Default: None)
     * @param requiredPokemonName: The name of the Pokemon needed for the mutation to occur (Default: None)
     */
    static __internal__addUnlockMutationStrategy(berryType,
                                                 actionCallback,
                                                 minimumRequiredBerry = 1,
                                                 oakItemNeeded = null,
                                                 oakItemsToRemove = [],
                                                 requiredPokemonName = null)
    {
        this.__internal__unlockStrategySelection.push(
            {
                // Check if the berry is unlocked and the player has at least 1 of them in stock or planted
                isNeeded: function()
                    {
                        if (!App.game.farming.unlockedBerries[berryType]())
                        {
                            return true;
                        }

                        let totalCount = App.game.farming.berryList[berryType]() + this.__internal__getPlantedBerriesCount(berryType);
                        return (totalCount < minimumRequiredBerry);
                    }.bind(this),
                berryToUnlock: berryType,
                harvestAsSoonAsPossible: false,
                oakItemToEquip: oakItemNeeded,
                forbiddenOakItems: oakItemsToRemove,
                requiredPokemon: requiredPokemonName,
                requiresDiscord: false,
                action: actionCallback
            });
    }

    /**
     * @brief Adds an unlock strategy that requires a certain amount of berry before proceeding any further
     *
     * @param berriesMinAmount: The minimum amount that is required for each berry
     * @param berriesToGather: The types of berry the player must have
     */
    static __internal__addBerryRequirementBeforeFurtherUnlockStrategy(berriesMinAmount, berriesToGather)
    {
        this.__internal__unlockStrategySelection.push(
            {
                // Check if all berries are in sufficient amount
                isNeeded: function()
                {
                    return !berriesToGather.every(
                        (berryType) =>
                        {
                            let alreadyPlantedCount = Automation.Farm.__internal__getPlantedBerriesCount(berryType);
                            let berryHarvestAmount = App.game.farming.berryData[berryType].harvestAmount;

                            return (App.game.farming.berryList[berryType]() >= (berriesMinAmount - (alreadyPlantedCount * berryHarvestAmount)))
                        });
                },
                harvestAsSoonAsPossible: true,
                oakItemToEquip: null,
                forbiddenOakItems: [],
                requiredPokemon: null,
                requiresDiscord: false,
                // If not, then farm some needed berries
                action: function()
                {
                    let plotIndex = 0;
                    for (const berryType of berriesToGather)
                    {
                        if (!App.game.farming.hasBerry(berryType))
                        {
                            continue;
                        }

                        let neededAmount = (berriesMinAmount - App.game.farming.berryList[berryType]());
                        let berryHarvestAmount = App.game.farming.berryData[berryType].harvestAmount;

                        let alreadyPlantedCount = this.__internal__getPlantedBerriesCount(berryType);
                        neededAmount -= (alreadyPlantedCount * berryHarvestAmount);

                        while ((neededAmount > 0) && (plotIndex <= 24) && App.game.farming.hasBerry(berryType))
                        {
                            if (App.game.farming.plotList[plotIndex].isUnlocked
                                && App.game.farming.plotList[plotIndex].isEmpty())
                            {
                                App.game.farming.plant(plotIndex, berryType, true);

                                // Subtract the harvest amount (-1 for the planted berry)
                                neededAmount -= (berryHarvestAmount - 1);
                            }
                            plotIndex++;
                        }

                        if (plotIndex > 24)
                        {
                            break;
                        }
                    }

                    // If no more berries are needed, plant Cheris on the remaining plots
                    FarmController.selectedBerry(BerryType.Cheri);
                    Automation.Farm.__internal__plantAllBerries();
                }.bind(this)
            });
    }

    /**
     * @brief Chooses the next unlock strategy based on the current farming state
     */
    static __internal__chooseUnlockStrategy()
    {
        this.__internal__currentStrategy = null;

        for (const strategy of this.__internal__unlockStrategySelection)
        {
            if (strategy.isNeeded())
            {
                this.__internal__currentStrategy = strategy;
                break;
            }
        }

        // If no strategy can be found, turn off the feature and disable the button
        if (this.__internal__currentStrategy === null)
        {
            this.__internal__disableAutoUnlock("No more automated unlock possible");
            Automation.Utils.sendWarningNotif("No more automated unlock possible.\nDisabling the 'Auto unlock' feature", "Farming");
            return;
        }

        this.__internal__checkOakItemRequirement();
        this.__internal__checkPokemonRequirement();
        this.__internal__checkDiscordLinkRequirement();
    }

    /**
     * @brief If the new strategy requires an Oak item that the player does not have, turn off the feature and disable the button
     */
    static __internal__checkOakItemRequirement()
    {
        if (this.__internal__currentStrategy.oakItemToEquip === null)
        {
            return;
        }

        let oakItem = App.game.oakItems.itemList[this.__internal__currentStrategy.oakItemToEquip];

        if ((Automation.Utils.LocalStorage.getValue(this.Settings.OakItemLoadoutUpdate) !== "true")
            && !oakItem.isActive)
        {
            this.__internal__disableAutoUnlock("The next unlock requires the '" + oakItem.displayName + "' Oak item\n"
                                             + "and loadout auto-update was disabled.\n"
                                             + "You can either equip it manually or turn auto-equip back on.");

            // Set a watcher to re-enable the feature once the item is equipped or the option was re-enabled
            let watcher = setInterval(function()
                {
                    if ((Automation.Utils.LocalStorage.getValue(this.Settings.OakItemLoadoutUpdate) === "true")
                        || App.game.oakItems.itemList[this.__internal__currentStrategy.oakItemToEquip].isActive)
                    {
                        Automation.Menu.setButtonDisabledState(this.Settings.FocusOnUnlocks, false);
                        clearInterval(watcher);
                    }
                }.bind(this), 5000); // Check every 5s

            return;
        }

        if (oakItem.isUnlocked())
        {
            return;
        }

        this.__internal__disableAutoUnlock("The '" + oakItem.displayName + "' Oak item is required for the next unlock");

        // Set a watcher to re-enable the feature once the item is unlocked
        let watcher = setInterval(function()
            {
                if (App.game.oakItems.itemList[this.__internal__currentStrategy.oakItemToEquip].isUnlocked())
                {
                    Automation.Menu.setButtonDisabledState(this.Settings.FocusOnUnlocks, false);
                    clearInterval(watcher);
                }
            }.bind(this), 5000); // Check every 5s
    }

    /**
     * @brief If the new strategy requires a pokemon that the player does not have, turn off the feature and disable the button
     */
    static __internal__checkPokemonRequirement()
    {
        if (this.__internal__currentStrategy.requiredPokemon === null)
        {
            return;
        }

        // Check if the needed pokemon was caught
        let neededPokemonId = PokemonHelper.getPokemonByName(this.__internal__currentStrategy.requiredPokemon).id;
        if (App.game.statistics.pokemonCaptured[neededPokemonId]() !== 0)
        {
            return;
        }

        this.__internal__disableAutoUnlock("You need to catch " + this.__internal__currentStrategy.requiredPokemon
                                         + " (#" + neededPokemonId.toString() + ") for the next unlock");

        // Set a watcher to re-enable the feature once the pokemon has been caught
        let watcher = setInterval(function()
            {
                if (App.game.statistics.pokemonCaptured[neededPokemonId]() !== 0)
                {
                    Automation.Menu.setButtonDisabledState(this.Settings.FocusOnUnlocks, false);
                    clearInterval(watcher);
                }
            }.bind(this), 5000); // Check every 5s
    }

    /**
     * @brief If the new strategy requires a linked discord account and it's not the case, turn off the feature and disable the button
     */
    static __internal__checkDiscordLinkRequirement()
    {
        if (!this.__internal__currentStrategy.requiresDiscord)
        {
            return;
        }

        // Check if the discord is linked and all hints are gathered
        if (App.game.discord.ID() !== null)
        {
            let enigmaMutation = App.game.farming.mutations.filter((mutation) => mutation instanceof EnigmaMutation)[0];

            if (enigmaMutation.hintsSeen.every((seen) => seen()))
            {
                return;
            }

            this.__internal__disableAutoUnlock("You need to collect the four hints from the Kanto Berry Master\n"
                                             + "for the next unlock. He's located in Cerulean City.");
        }
        else
        {
            this.__internal__disableAutoUnlock("A linked discord account is needed for the next unlock.");
        }

        // Set a watcher to re-enable the feature once the pokemon has been caught
        let watcher = setInterval(function()
            {
                if (App.game.discord.ID() === null)
                {
                    return;
                }

                let enigmaMutation = App.game.farming.mutations.filter((mutation) => mutation instanceof EnigmaMutation)[0];

                if (enigmaMutation.hintsSeen.every((seen) => seen()))
                {
                    Automation.Menu.setButtonDisabledState(this.Settings.FocusOnUnlocks, false);
                    clearInterval(watcher);
                }
            }.bind(this), 5000); // Check every 5s
    }

    /**
     * @brief Gets the planted count for the given @p berryType
     *
     * @param berryType: The type of the berry
     *
     * @returns The number of planted berries of the given type
     */
    static __internal__getPlantedBerriesCount(berryType)
    {
        return App.game.farming.plotList.reduce((count, plot) => count + ((plot.berryData && (plot.berry == berryType)) ? 1 : 0), 0);
    }

    /**
     * @brief Disables the 'Auto unlock' button
     *
     * @param reason: The reason for disabling the button to display in the tooltip
     */
    static __internal__disableAutoUnlock(reason)
    {
        // TODO (06/08/2022): Don't turn the feature off in most cases
        Automation.Menu.forceAutomationState(this.Settings.FocusOnUnlocks, false);
        Automation.Menu.setButtonDisabledState(this.Settings.FocusOnUnlocks, true, reason);
        Automation.Utils.OakItem.ForbiddenItems = [];
    }

    /**
     * @brief Sends the Farming automation notification, if at least a berry was harvested
     *
     * @param {string} details: The extra-message to display
     */
    static __internal__sendNotif(details)
    {
        if (this.__internal__plantedBerryCount > 0)
        {
            Automation.Utils.sendNotif("Harvested " + this.__internal__harvestCount.toString() + " berries<br>" + details, "Farming");
        }
    }
}
